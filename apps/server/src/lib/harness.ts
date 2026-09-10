import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
	AssignmentStatus,
	CoverageGap,
	CoverageSummary,
	Finding,
	ReviewAssignment,
	ReviewBudgetSnapshot,
	ReviewOutcome,
	ReviewStage,
	ReviewTask,
	RoleDecision
} from '@recoder/shared';
import { extractFindingsJson } from './json-extract.js';
import { configForRole, reviewLimits, type ReviewRole } from './models.js';
import { extraExcludes } from './review-scope.js';
import { ROLE_LABELS } from './roles.js';
import { REVIEW_POLICY } from './review-policy.js';
import {
	AuthConfigError,
	ModelBudget,
	ReviewAbortedError,
	canLaunchInvestigation,
	runJsonAgent
} from './agent-loop.js';
import { EvidenceStore, formatToolResults, type ReviewRevision } from './evidence.js';
import { buildInventory, type ReviewInventory } from './inventory.js';
import { CoverageLedger } from './coverage.js';
import {
	fallbackPlan,
	plannerSystemPrompt,
	plannerValidationError,
	plannerUserPrompt,
	sanitizePlannerOutput,
	type PlannerAssignment,
	type PlannerOutput
} from './planner.js';
import { parseSpecialistOutput, specialistSystemPrompt, specialistUserPrompt } from './specialist.js';
import {
	applyConsolidation,
	consolidationSchema,
	consolidationSystemPrompt,
	consolidationUserPrompt,
	deterministicConsolidate,
	validateCandidate,
	type CandidateFinding
} from './consolidate.js';

export { extractFindingsJson };
export type { ReviewRevision };

const INSTRUCTION_PATHS = [
	'AGENTS.md',
	'CLAUDE.md',
	'CONTRIBUTING.md',
	'.github/CONTRIBUTING.md',
	'docs/CONTRIBUTING.md'
];

/**
 * Custom review harness. Read-only by construction:
 * - inputs are the PR diff + git objects from the sandbox checkout;
 * - the model is instructed (and the output schema enforces) review-only
 *   findings — no patches, no commands, no file writes;
 * - this module never writes to the checkout and never exposes a shell.
 */

export interface HarnessEvents {
	onTask?: (task: Omit<ReviewTask, 'updatedAt'>) => void;
	onLog?: (message: string, meta?: { assignmentId?: string; role?: string }) => void;
	onPlan?: (data: {
		planVersion: number;
		summary: string;
		assignments: ReviewAssignment[];
		roleDecisions: RoleDecision[];
		planningDegraded?: boolean;
	}) => void;
	onAssignment?: (assignment: ReviewAssignment) => void;
	onCoverage?: (coverage: CoverageSummary, gaps: CoverageGap[]) => void;
	onBudget?: (budget: ReviewBudgetSnapshot) => void;
	onCandidates?: (count: number) => void;
	onStage?: (stage: ReviewStage) => void;
}

/** Safely read a sandbox file (stays inside the checkout, capped length). */
export async function readSandboxFile(sandboxPath: string, file: string, maxChars: number): Promise<string | null> {
	const root = resolve(sandboxPath);
	const resolved = resolve(join(sandboxPath, file));
	if (resolved !== root && !resolved.startsWith(root + '/')) return null;
	try {
		const info = await lstat(resolved);
		if (info.isSymbolicLink() || !info.isFile()) return null;
		const text = await readFile(resolved, 'utf8');
		return text.length > maxChars ? text.slice(0, maxChars) + '\n…[truncated]' : text;
	} catch {
		return null;
	}
}

/** Numbered line window around `center` (1-based), for discussion context. */
export async function readExcerpt(
	sandboxPath: string,
	file: string,
	center: number,
	radius = 40,
	maxChars = 8000
): Promise<string | null> {
	const text = await readSandboxFile(sandboxPath, file, maxChars * 4);
	if (text === null) return null;
	const lines = text.split('\n');
	const start = Math.max(0, center - radius - 1);
	const excerpt = lines.slice(start, center + radius).join('\n');
	const numbered = excerpt
		.split('\n')
		.map((content, i) => `${start + i + 1}: ${content}`)
		.join('\n');
	return numbered.length > maxChars ? numbered.slice(0, maxChars) + '\n…[truncated]' : numbered;
}

function normalizeAnchor(text: string): string {
	return text
		.split('\n')
		.map((line) => line.trim().replace(/\s+/g, ' '))
		.filter(Boolean)
		.join('\n');
}

export function fingerprintFinding(file: string, category: string, anchorText: string): string {
	return createHash('sha256')
		.update(`${file}\n${category}\n${normalizeAnchor(anchorText)}`)
		.digest('hex')
		.slice(0, 16);
}

export function filterNewFindings(
	current: Finding[],
	previousFingerprints: Set<string>
): { fresh: Finding[]; suppressed: number } {
	const seen = new Set<string>();
	const fresh: Finding[] = [];
	let suppressed = 0;
	for (const finding of current) {
		const fp = finding.fingerprint;
		if (!fp || previousFingerprints.has(fp) || seen.has(fp)) {
			suppressed++;
			continue;
		}
		seen.add(fp);
		fresh.push(finding);
	}
	return { fresh, suppressed };
}

export interface AdaptiveReviewInput {
	diff: string;
	sandboxPath: string | null;
	revision?: ReviewRevision | null;
	prTitle?: string | null;
	prBody?: string | null;
	signal?: AbortSignal;
}

export interface AdaptiveReviewResult {
	findings: Finding[];
	unconfirmed: Finding[];
	summary: string;
	outcome: ReviewOutcome;
	recommendedChecks: string[];
	coverage: CoverageSummary;
	coverageGaps: CoverageGap[];
	assignments: ReviewAssignment[];
	planningDegraded: boolean;
	error?: string;
}

export async function runAdaptiveReview(
	input: AdaptiveReviewInput,
	events?: HarnessEvents
): Promise<AdaptiveReviewResult> {
	const deadlineAt = Date.now() + REVIEW_POLICY.analysisDeadlineMs;
	const controller = new AbortController();
	const onAbort = () => controller.abort();
	input.signal?.addEventListener('abort', onAbort, { once: true });
	const timeout = setTimeout(() => controller.abort(), REVIEW_POLICY.analysisDeadlineMs);
	const budget = new ModelBudget();
	const limits = reviewLimits();
	const inventory = buildInventory(input.diff, extraExcludes());
	const revision = input.revision ?? (input.sandboxPath
		? {
				checkoutPath: input.sandboxPath,
				headSha: 'HEAD',
				targetSha: '',
				mergeBaseSha: '',
				targetRef: ''
			}
		: null);
	const evidence = new EvidenceStore(input.revision ?? null, inventory, limits.maxFileChars);
	const coverage = new CoverageLedger();
	coverage.seed(inventory);
	const assignments: ReviewAssignment[] = [];
	const publishCoverage = () => events?.onCoverage?.(coverage.summary(), coverage.gaps());
	const publishBudget = () => events?.onBudget?.(budget.snapshot());
	const task = (
		id: string,
		label: string,
		status: ReviewTask['status'],
		message: string,
		extra?: Partial<ReviewTask>
	) =>
		events?.onTask?.({
			id,
			label,
			status,
			message,
			kind: extra?.kind ?? 'other',
			...extra
		});

	try {
		events?.onStage?.('understand');
		task('inventory', 'Understand changes', 'running', 'Building the change inventory', { kind: 'inventory' });
		await loadGuidance(inventory, evidence, controller.signal);
		task('inventory', 'Understand changes', 'done', `Inventoried ${inventory.files.length} changed path${inventory.files.length === 1 ? '' : 's'}`, {
			kind: 'inventory'
		});
		publishCoverage();

		events?.onStage?.('specialists');
		task('planning', 'Planning the review', 'running', 'Planning specialist assignments', {
			kind: 'planning',
			agent: 'correctness'
		});
		let planningDegraded = false;
		let plan: PlannerOutput;
		try {
			const planned = await runPlanner({
				inventory,
				evidence,
				budget,
				deadlineAt,
				signal: controller.signal,
				title: input.prTitle ?? '',
				body: input.prBody ?? '',
				events,
				task
			});
			plan = planned.plan;
			planningDegraded = planned.degraded;
		} catch (err) {
			if (err instanceof AuthConfigError) throw err;
			planningDegraded = true;
			plan = fallbackPlan(inventory, err instanceof Error ? err.message : 'Planning failed');
		}
		if (plan.assignments.length === 0) {
			plan = fallbackPlan(inventory);
			planningDegraded = true;
		}

		for (const item of plan.assignments) {
			for (const scope of item.scope) {
				for (const hunkId of scope.hunkIds) coverage.assign(hunkId, scope.path, item.role);
			}
			assignments.push(toAssignmentRecord(item, 'queued'));
		}
		coverage.excludeUnassigned(inventory);
		events?.onPlan?.({
			planVersion: 1,
			summary: plan.summary,
			assignments: assignments.map((assignment) => ({ ...assignment })),
			roleDecisions: plan.roleDecisions,
			planningDegraded
		});
		task('planning', 'Planning the review', planningDegraded ? 'partial' : 'done', plan.summary, {
			kind: 'planning',
			agent: 'correctness'
		});
		publishCoverage();
		publishBudget();

		const candidates: CandidateFinding[] = [];
		let nextCandidate = 1;
		const recommended = new Set<string>();
		const followUps: PlannerAssignment[] = [];

		await runAssignmentPool(
			plan.assignments,
			assignments,
			{
				inventory,
				evidence,
				coverage,
				budget,
				deadlineAt,
				signal: controller.signal,
				events,
				task,
				candidates,
				nextCandidate: () => `c${nextCandidate++}`,
				recommended,
				followUps
			}
		);
		publishCoverage();
		publishBudget();
		events?.onCandidates?.(candidates.filter((candidate) => candidate.valid).length);

		if (
			followUps.length > 0 &&
			canLaunchInvestigation(deadlineAt, budget) &&
			assignments.length < REVIEW_POLICY.maxInitialAssignments + REVIEW_POLICY.maxFollowUpAssignments
		) {
			const extra = await selectFollowUps(followUps, inventory, evidence, budget, deadlineAt, controller.signal, events);
			for (const item of extra) {
				for (const scope of item.scope) {
					for (const hunkId of scope.hunkIds) coverage.assign(hunkId, scope.path, item.role);
				}
				const record = toAssignmentRecord(item, 'queued', true);
				assignments.push(record);
				events?.onAssignment?.(record);
			}
			if (extra.length) {
				events?.onPlan?.({
					planVersion: 2,
					summary: plan.summary,
					assignments: assignments.map((assignment) => ({ ...assignment })),
					roleDecisions: plan.roleDecisions,
					planningDegraded
				});
				await runAssignmentPool(extra, assignments, {
					inventory,
					evidence,
					coverage,
					budget,
					deadlineAt,
					signal: controller.signal,
					events,
					task,
					candidates,
					nextCandidate: () => `c${nextCandidate++}`,
					recommended,
					followUps: []
				});
			}
		}

		events?.onStage?.('consolidation');
		events?.onCandidates?.(candidates.filter((candidate) => candidate.valid).length);
		const valid = candidates.filter((candidate) => candidate.valid);
		task('consolidation', 'Consolidating findings', 'running', `Consolidating ${valid.length} candidate${valid.length === 1 ? '' : 's'}`, {
			kind: 'consolidation'
		});

		let confirmed: Finding[] = [];
		let unconfirmed: Finding[] = [];
		let outcome: ReviewOutcome = 'complete';
		let error: string | undefined;
		const checks = [...recommended];

		if (valid.length === 0) {
			confirmed = [];
			task('consolidation', 'Consolidating findings', 'done', 'No candidates to consolidate', { kind: 'consolidation' });
		} else if (!budget.canSpend(1, { consumeReserve: true }) || Date.now() >= deadlineAt) {
			unconfirmed = valid;
			outcome = 'partial';
			error = 'Reserved consolidation call was unavailable';
			task('consolidation', 'Consolidating findings', 'error', error, { kind: 'consolidation' });
		} else {
			try {
				const cfg = configForRole('correctness');
				const result = await runJsonAgent({
					label: 'consolidation',
					system: consolidationSystemPrompt(),
					user: consolidationUserPrompt(valid, evidence),
					config: cfg,
					budget,
					evidence,
					maxTurns: 1,
					signal: controller.signal,
					deadlineAt,
					consumeReserve: true,
					parse: (raw) => {
						const parsed = consolidationSchema.safeParse(raw);
						return parsed.success ? parsed.data : null;
					},
					onProgress: (state, elapsedMs, detail) =>
						task('consolidation', 'Consolidating findings', state === 'queued' ? 'waiting' : 'running', detail, {
							kind: 'consolidation',
							model: cfg.model,
							elapsedMs
						}),
					onLog: (message) => events?.onLog?.(message)
				});
				if (result.value) {
					const applied = applyConsolidation(result.value, valid);
					confirmed = applied.confirmed;
					for (const check of result.value.recommendedChecks) checks.push(check);
					task('consolidation', 'Consolidating findings', 'done', `Confirmed ${confirmed.length} finding${confirmed.length === 1 ? '' : 's'}`, {
						kind: 'consolidation'
					});
				} else {
					unconfirmed = valid;
					outcome = 'partial';
					error = result.error ?? 'Consolidation failed';
					task('consolidation', 'Consolidating findings', 'error', error, { kind: 'consolidation' });
				}
			} catch (err) {
				if (err instanceof AuthConfigError) throw err;
				unconfirmed = valid;
				outcome = 'partial';
				error = err instanceof Error ? err.message : 'Consolidation failed';
				task('consolidation', 'Consolidating findings', 'error', error, { kind: 'consolidation' });
			}
		}

		publishCoverage();
		publishBudget();
		if (outcome === 'complete' && !coverage.complete()) outcome = 'partial';
		if (outcome === 'complete' && assignments.some((assignment) => assignment.status === 'error' || assignment.status === 'partial')) {
			outcome = 'partial';
		}

		const summary = buildSummary({
			plan,
			assignments,
			confirmed,
			unconfirmed,
			outcome,
			planningDegraded,
			checks,
			coverage: coverage.summary()
		});
		return {
			findings: confirmed,
			unconfirmed,
			summary,
			outcome,
			recommendedChecks: [...new Set(checks)],
			coverage: coverage.summary(),
			coverageGaps: coverage.gaps(),
			assignments,
			planningDegraded,
			error
		};
	} catch (err) {
		if (err instanceof AuthConfigError) {
			return failReview(assignments, coverage, budget, err.message, 'failed');
		}
		if (err instanceof ReviewAbortedError || controller.signal.aborted) {
			return failReview(assignments, coverage, budget, 'Review analysis deadline reached', 'failed');
		}
		return failReview(assignments, coverage, budget, err instanceof Error ? err.message : 'Review failed', 'failed');
	} finally {
		clearTimeout(timeout);
		input.signal?.removeEventListener('abort', onAbort);
	}
}

function failReview(
	assignments: ReviewAssignment[],
	coverage: CoverageLedger,
	_budget: ModelBudget,
	error: string,
	outcome: ReviewOutcome
): AdaptiveReviewResult {
	return {
		findings: [],
		unconfirmed: [],
		summary: error,
		outcome,
		recommendedChecks: [],
		coverage: coverage.summary(),
		coverageGaps: coverage.gaps(),
		assignments,
		planningDegraded: true,
		error
	};
}

async function runPlanner(input: {
	inventory: ReviewInventory;
	evidence: EvidenceStore;
	budget: ModelBudget;
	deadlineAt: number;
	signal: AbortSignal;
	title: string;
	body: string;
	events?: HarnessEvents;
	task: (id: string, label: string, status: ReviewTask['status'], message: string, extra?: Partial<ReviewTask>) => void;
}): Promise<{ plan: PlannerOutput; degraded: boolean }> {
	const cfg = configForRole('correctness');
	if (!canLaunchInvestigation(input.deadlineAt, input.budget)) {
		return { plan: fallbackPlan(input.inventory, 'No model budget remained for planning.'), degraded: true };
	}
	const result = await runJsonAgent({
		label: 'planner',
		system: plannerSystemPrompt(),
		user: plannerUserPrompt({ title: input.title, body: input.body, inventory: input.inventory }),
		config: cfg,
		budget: input.budget,
		evidence: input.evidence,
		maxTurns: REVIEW_POLICY.maxPlannerTurns,
		signal: input.signal,
		deadlineAt: input.deadlineAt,
		parse: (raw) => sanitizePlannerOutput(raw, input.inventory),
		validationError: plannerValidationError,
		onProgress: (state, elapsedMs, detail) =>
			input.task('planning', 'Planning the review', state === 'queued' ? 'waiting' : 'running', detail, {
				kind: 'planning',
				agent: 'correctness',
				model: cfg.model,
				elapsedMs
			}),
		onLog: (message) => input.events?.onLog?.(message, { role: 'correctness' })
	});
	if (result.value) return { plan: result.value, degraded: false };
	return {
		plan: fallbackPlan(input.inventory, result.error ?? 'Planner output was invalid; using bounded fallback assignments.'),
		degraded: true
	};
}

async function selectFollowUps(
	requests: PlannerAssignment[],
	inventory: ReviewInventory,
	evidence: EvidenceStore,
	budget: ModelBudget,
	deadlineAt: number,
	signal: AbortSignal,
	events?: HarnessEvents
): Promise<PlannerAssignment[]> {
	const unique: PlannerAssignment[] = [];
	const seen = new Set<string>();
	for (const request of requests) {
		if (seen.has(request.id) || request.id === request.role) continue;
		const sanitized = sanitizePlannerOutput(
			{
				summary: 'follow-up',
				assignments: [request],
				roleDecisions: []
			},
			inventory,
			true
		);
		if (!sanitized?.assignments[0]) continue;
		seen.add(request.id);
		unique.push({ ...sanitized.assignments[0], id: request.id.startsWith('follow-') ? request.id : `follow-${request.id}` });
		if (unique.length >= REVIEW_POLICY.maxFollowUpAssignments) break;
	}
	if (unique.length === 0) return [];
	if (!canLaunchInvestigation(deadlineAt, budget)) return unique.slice(0, REVIEW_POLICY.maxFollowUpAssignments);
	const cfg = configForRole('correctness');
	const result = await runJsonAgent({
		label: 'follow-up planning',
		system: plannerSystemPrompt() + '\nThis is a follow-up pass. Dispatch at most two narrowly scoped investigations.',
		user: `Pending follow-up requests:\n${JSON.stringify(unique, null, 2)}\n\nSelect at most two. Return planner JSON.`,
		config: cfg,
		budget,
		evidence,
		maxTurns: 1,
		signal,
		deadlineAt,
		parse: (raw) => sanitizePlannerOutput(raw, inventory, true),
		validationError: plannerValidationError,
		onLog: (message) => events?.onLog?.(message)
	});
	return (result.value?.assignments ?? unique).slice(0, REVIEW_POLICY.maxFollowUpAssignments);
}

interface PoolContext {
	inventory: ReviewInventory;
	evidence: EvidenceStore;
	coverage: CoverageLedger;
	budget: ModelBudget;
	deadlineAt: number;
	signal: AbortSignal;
	events?: HarnessEvents;
	task: (id: string, label: string, status: ReviewTask['status'], message: string, extra?: Partial<ReviewTask>) => void;
	candidates: CandidateFinding[];
	nextCandidate: () => string;
	recommended: Set<string>;
	followUps: PlannerAssignment[];
}

async function runAssignmentPool(
	items: PlannerAssignment[],
	records: ReviewAssignment[],
	ctx: PoolContext
): Promise<void> {
	const queue = [...items].sort((a, b) => a.priority - b.priority);
	let cursor = 0;
	const workers = Array.from({ length: Math.min(REVIEW_POLICY.maxConcurrentAssignments, queue.length) }, async () => {
		while (cursor < queue.length) {
			if (ctx.signal.aborted) return;
			if (!canLaunchInvestigation(ctx.deadlineAt, ctx.budget)) {
				while (cursor < queue.length) {
					const skipped = queue[cursor++];
					updateAssignment(records, skipped.id, {
						status: 'skipped',
						currentOperation: 'Not launched: budget or time reserved for consolidation'
					});
					ctx.events?.onAssignment?.(records.find((record) => record.id === skipped.id)!);
				}
				return;
			}
			const item = queue[cursor++];
			await runOneAssignment(item, records, ctx);
		}
	});
	await Promise.all(workers);
}

async function runOneAssignment(
	item: PlannerAssignment,
	records: ReviewAssignment[],
	ctx: PoolContext
): Promise<void> {
	const cfg = configForRole(item.role);
	const started = new Date().toISOString();
	updateAssignment(records, item.id, {
		status: 'queued',
		model: cfg.model,
		queuedAt: started,
		currentOperation: 'Queued for specialist review'
	});
	ctx.events?.onAssignment?.(records.find((record) => record.id === item.id)!);
	const taskId = `assignment:${item.id}`;
	ctx.task(taskId, item.title, 'queued', 'Queued for specialist review', {
		kind: 'assignment',
		assignmentId: item.id,
		agent: item.role,
		model: cfg.model,
		files: item.scope.map((entry) => entry.path),
		queuedAt: started,
		queueReason: 'Waiting for a specialist slot'
	});
	try {
		// Supply the first bounded patch page up front instead of spending a model
		// round asking for evidence we already know this assignment needs.
		const initialEvidence = await ctx.evidence.executeRound(item.scope.map((entry) => ({
			action: 'readDiff', path: entry.path, hunkIds: entry.hunkIds
		})), ctx.signal);
		const result = await runJsonAgent({
			label: item.title,
			system: specialistSystemPrompt(item.role),
			user: specialistUserPrompt(item, REVIEW_POLICY.maxSpecialistTurns, ctx.budget.remaining()) + '\n\nInitial scoped patch evidence (untrusted; retrieve remaining pages as needed):\n' + formatToolResults(initialEvidence),
			config: cfg,
			budget: ctx.budget,
			evidence: ctx.evidence,
			maxTurns: REVIEW_POLICY.maxSpecialistTurns,
			signal: ctx.signal,
			deadlineAt: ctx.deadlineAt,
			parse: parseSpecialistOutput,
			onProgress: (state, elapsedMs, detail) => {
				const status = state === 'queued' ? 'waiting' : 'running';
				updateAssignment(records, item.id, {
					status,
					currentOperation: detail,
					startedAt: started,
					elapsedMs: Date.now() - Date.parse(started),
					model: cfg.model
				});
				ctx.events?.onAssignment?.(records.find((record) => record.id === item.id)!);
				ctx.task(taskId, item.title, status, detail, {
					kind: state === 'retrieval' ? 'retrieval' : 'model',
					assignmentId: item.id,
					agent: item.role,
					model: cfg.model,
					elapsedMs,
					files: item.scope.map((entry) => entry.path)
				});
			},
			onLog: (message) => ctx.events?.onLog?.(message, { assignmentId: item.id, role: item.role })
		});
		const assignedHunks = new Set(item.scope.flatMap((entry) => entry.hunkIds));
		if (!result.value) {
			for (const hunkId of assignedHunks) {
				const path = ctx.inventory.hunksById.get(hunkId)?.file.path ?? item.scope[0]?.path ?? '';
				ctx.coverage.partial(hunkId, path, item.role, result.error ?? 'specialist failed');
			}
			updateAssignment(records, item.id, {
				status: 'error',
				currentOperation: result.error ?? 'Specialist failed',
				completedAt: new Date().toISOString()
			});
			ctx.task(taskId, item.title, 'error', result.error ?? 'Specialist failed', {
				kind: 'assignment',
				assignmentId: item.id,
				agent: item.role,
				model: cfg.model
			});
			ctx.events?.onAssignment?.(records.find((record) => record.id === item.id)!);
			return;
		}
		const examined = result.value.examinedHunks.filter((hunkId) => assignedHunks.has(hunkId));
		for (const hunkId of examined) {
			const path = ctx.inventory.hunksById.get(hunkId)?.file.path ?? '';
			ctx.coverage.examined(hunkId, path, item.role);
		}
		for (const hunkId of assignedHunks) {
			if (examined.includes(hunkId)) continue;
			const path = ctx.inventory.hunksById.get(hunkId)?.file.path ?? '';
			const gap = result.value.coverageGaps.find((itemGap) => itemGap.hunkId === hunkId);
			ctx.coverage.partial(hunkId, path, item.role, gap?.reason ?? 'assigned hunk was not examined');
		}
		const anchor = anchorFn(ctx.inventory);
		for (const raw of result.value.findings) {
			ctx.candidates.push(
				validateCandidate(
					raw,
					{
						candidateId: ctx.nextCandidate(),
						assignmentId: item.id,
						role: item.role,
						model: cfg.model,
						fingerprint: (file, category, start, end, side) =>
							fingerprintFinding(file, category, anchor(file, start, end, side))
					},
					ctx.inventory,
					ctx.evidence
				)
			);
		}
		for (const check of result.value.recommendedChecks) ctx.recommended.add(check);
		if (result.value.followUp) {
			ctx.followUps.push({
				id: result.value.followUp.id,
				role: result.value.followUp.role,
				title: result.value.followUp.title,
				reason: result.value.followUp.reason,
				scope: result.value.followUp.scope,
				questions: result.value.followUp.questions,
				contextEvidenceIds: result.value.followUp.contextEvidenceIds ?? [],
				priority: result.value.followUp.priority ?? 80
			});
		}
		const validCount = ctx.candidates.filter((candidate) => candidate.assignmentId === item.id && candidate.valid).length;
		const status: AssignmentStatus = examined.length === assignedHunks.size ? 'done' : 'partial';
		updateAssignment(records, item.id, {
			status,
			candidateCount: validCount,
			currentOperation:
				status === 'done'
					? `Finished · ${validCount} candidate${validCount === 1 ? '' : 's'}`
					: `Partial coverage · ${validCount} candidate${validCount === 1 ? '' : 's'}`,
			completedAt: new Date().toISOString()
		});
		ctx.task(taskId, item.title, status === 'done' ? 'done' : 'partial', records.find((record) => record.id === item.id)?.currentOperation ?? 'Finished', {
			kind: 'assignment',
			assignmentId: item.id,
			agent: item.role,
			model: cfg.model,
			candidateCount: validCount,
			files: item.scope.map((entry) => entry.path)
		});
		ctx.events?.onAssignment?.(records.find((record) => record.id === item.id)!);
		ctx.events?.onCandidates?.(ctx.candidates.filter((candidate) => candidate.valid).length);
	} catch (err) {
		if (err instanceof AuthConfigError) throw err;
		if (err instanceof ReviewAbortedError) throw err;
		updateAssignment(records, item.id, {
			status: 'error',
			currentOperation: err instanceof Error ? err.message : 'Specialist failed',
			completedAt: new Date().toISOString()
		});
		ctx.task(taskId, item.title, 'error', err instanceof Error ? err.message : 'Specialist failed', {
			kind: 'assignment',
			assignmentId: item.id,
			agent: item.role
		});
		ctx.events?.onAssignment?.(records.find((record) => record.id === item.id)!);
	}
}

function updateAssignment(records: ReviewAssignment[], id: string, patch: Partial<ReviewAssignment>): void {
	const index = records.findIndex((record) => record.id === id);
	if (index < 0) return;
	records[index] = { ...records[index], ...patch };
	const record = records[index];
	if (record.completedAt && (record.startedAt || record.queuedAt)) {
		record.elapsedMs = Math.max(0, Date.parse(record.completedAt) - Date.parse(record.startedAt ?? record.queuedAt!));
	}
}

function toAssignmentRecord(item: PlannerAssignment, status: AssignmentStatus, followUp = false): ReviewAssignment {
	return {
		id: item.id,
		role: item.role,
		title: item.title,
		reason: item.reason,
		status,
		scope: item.scope,
		questions: item.questions,
		priority: item.priority,
		followUp,
		candidateCount: 0,
		currentOperation: status === 'queued' ? 'Queued for specialist review' : undefined,
		queuedAt: new Date().toISOString()
	};
}

function anchorFn(inventory: ReviewInventory) {
	return (file: string, start: number, end: number, side: 'old' | 'new'): string => {
		const diff = inventory.diffs.find((entry) => entry.path === file);
		if (!diff) return '';
		const out: string[] = [];
		for (const hunk of diff.hunks) {
			for (const line of hunk.lines) {
				const no = side === 'old' ? line.oldNo : line.newNo;
				if (no !== null && no >= start && no <= end) out.push(line.text);
			}
		}
		return out.join('\n');
	};
}

async function loadGuidance(inventory: ReviewInventory, evidence: EvidenceStore, signal: AbortSignal): Promise<void> {
	if (!evidence.revision) return;
	const reads = INSTRUCTION_PATHS.map((path) => ({ action: 'readFile' as const, revision: 'target', path, startLine: 1, endLine: 80 }));
	for (let i = 0; i < reads.length; i += REVIEW_POLICY.maxRetrievalsPerTurn) {
		const results = await evidence.executeRound(reads.slice(i, i + REVIEW_POLICY.maxRetrievalsPerTurn), signal);
		for (const result of results) {
			if (!result.ok || !result.path || !result.content.trim()) continue;
			inventory.instructionFiles.push({
				path: result.path,
				excerpt: result.content.slice(0, 4000),
				truncated: result.truncated
			});
		}
	}
	const related = new Set<string>();
	const sources = inventory.files.filter((file) => file.classification === 'source' || file.classification === 'test').slice(0, 5);
	for (const file of sources) {
		const base = file.path.split('/').pop()?.replace(/\.[^.]+$/, '');
		if (!base || base.length < 3) continue;
		const results = await evidence.executeRound(
			[{ action: 'search', revision: 'target', query: base, prefix: '' }],
			signal
		);
		for (const result of results) {
			if (!result.ok) continue;
			for (const line of result.content.split('\n').slice(0, 8)) {
				const path = line.replace(/^[^:]+:/, '').split(':')[0];
				if (path && path !== file.path) related.add(path);
			}
		}
	}
	inventory.relatedPaths = [...related].slice(0, 16);
}

function buildSummary(input: {
	plan: PlannerOutput;
	assignments: ReviewAssignment[];
	confirmed: Finding[];
	unconfirmed: Finding[];
	outcome: ReviewOutcome;
	planningDegraded: boolean;
	checks: string[];
	coverage: CoverageSummary;
}): string {
	const roles = input.assignments.map((assignment) => `${ROLE_LABELS[assignment.role as ReviewRole] ?? assignment.role} (${assignment.id})`);
	const bits = [
		input.plan.summary,
		`Specialists: ${roles.join(', ') || 'none'}.`,
		`Coverage: ${input.coverage.reviewed} reviewed, ${input.coverage.partial} partial, ${input.coverage.excluded} excluded, ${input.coverage.pending} pending.`,
		input.unconfirmed.length
			? `${input.unconfirmed.length} unconfirmed candidate${input.unconfirmed.length === 1 ? '' : 's'} retained; this is not evidence the PR is clean.`
			: `Confirmed findings: ${input.confirmed.length}.`,
		input.planningDegraded ? 'Planning was degraded.' : '',
		input.outcome === 'complete' ? 'Review complete (not a merge approval).' : `Review ${input.outcome}.`
	];
	return bits.filter(Boolean).join(' ');
}
