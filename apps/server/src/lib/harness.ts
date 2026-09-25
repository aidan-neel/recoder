import { createHash } from 'node:crypto';
import { reviewNow } from './review-control.js';
import { lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
	AssignmentStatus,
	CoverageGap,
	CoverageSummary,
	Finding,
	ReviewAssignment,
	ReviewBudgetSnapshot,
	ReviewChatMessage,
	ReviewOutcome,
	ReviewReasoningEntry,
	ReviewStage,
	ReviewTask,
	RoleDecision
} from '@recoder/shared';
import { extractFindingsJson } from './json-extract.js';
import { configForOrchestrator, configForRole, reviewLimits, type ReviewRole } from './models.js';
import { extraExcludes } from './review-scope.js';
import { REVIEW_POLICY } from './review-policy.js';
import {
	AuthConfigError,
	ModelBudget,
	ReviewAbortedError,
	canLaunchInvestigation,
	runJsonAgent
} from './agent-loop.js';
import { EvidenceStore, formatToolResults, type ReviewRevision, type ToolCallReport } from './evidence.js';
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
import { GUIDELINES_PATH, type ReviewGuidelinesUsed } from '@recoder/shared';
import { composeGuidelines, readGlobalGuidelines, withGuidelines, type GuidelinesInput } from './guidelines.js';
import { parseSpecialistOutput, specialistSystemPrompt, specialistUserPrompt, specialistValidationError } from './specialist.js';
import { ExecWorkspace, type SetupReport } from './exec-workspace.js';
import { execUnavailableReason } from './exec-sandbox.js';
import { EXEC_EXAMPLES } from './prompts.js';
import { parseVerdict, settleVerdict, verdictValidationError, verifierSystemPrompt, verifierUserPrompt } from './verify.js';
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
 * Custom review harness. Reviewers never change the pull request:
 * - inputs are the PR diff + git objects from the sandbox checkout;
 * - the model is instructed (and the output schema enforces) review-only
 *   findings — no patches, pushes or comments;
 * - when bubblewrap is available, agents may run commands and write scratch
 *   files, but only inside an isolated, offline copy of the checkout
 *   (`exec-sandbox.ts`); tracked files are restored after every command.
 *
 * Stages: understand → plan → baseline checks → specialists → verify →
 * consolidate. Verification re-proves every candidate by running code.
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
	onReasoning?: (reasoning: Omit<ReviewReasoningEntry, 'at'>) => void;
	onMessage?: (message: Omit<ReviewChatMessage, 'at' | 'from'>) => void;
	getDiscussion?: (assignmentId?: string) => string;
	onTool?: (tool: ToolCallReport & { assignmentId?: string; role?: string }) => void;
	/** Which owner guidelines this review runs with (reported once, after inventory). */
	onGuidelines?: (used: ReviewGuidelinesUsed) => void;
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
	/** Reviewers, assignees, linked issues (untrusted). */
	prContext?: string | null;
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
	const deadlineAt = reviewNow() + REVIEW_POLICY.analysisDeadlineMs;
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
	const execReason = input.revision ? await execUnavailableReason() : 'Running code needs a local checkout of the pull request.';
	const workspace = input.revision && !execReason ? new ExecWorkspace(input.revision.checkoutPath, input.revision.headSha) : null;
	if (workspace) {
		workspace.deadlineAt = deadlineAt - REVIEW_POLICY.reserveMsForConsolidation;
		evidence.exec = workspace;
	} else if (execReason) {
		evidence.execUnavailable = execReason;
	}
	// Planning and specialists stop early enough for verification to run.
	const investigationDeadline = workspace ? deadlineAt - REVIEW_POLICY.reserveMsForVerification : deadlineAt;
	budget.reserve = REVIEW_POLICY.reserveCallsForConsolidation + (workspace ? REVIEW_POLICY.reserveCallsForVerification : 0);
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
		await loadGuidance(inventory, evidence, controller.signal, events?.onTool);
		const guidelines = composeGuidelines({
			global: readGlobalGuidelines().content,
			repo: await loadRepoGuidelines(evidence, controller.signal, events?.onTool)
		});
		inventory.guidelines = guidelines?.block ?? null;
		if (guidelines) events?.onGuidelines?.(guidelines.used);
		task('inventory', 'Understand changes', 'done', `Inventoried ${inventory.files.length} changed path${inventory.files.length === 1 ? '' : 's'}`, {
			kind: 'inventory'
		});
		publishCoverage();
		if (!workspace) events?.onLog?.(`Reviewing without running code: ${execReason}`);
		// Dependencies install while the planner works.
		const setup = workspace ? installDependencies(workspace, controller.signal, events, task) : Promise.resolve(null);
		const execNotes = workspace ? await plannerExecNotes(workspace) : undefined;

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
				deadlineAt: investigationDeadline,
				exec: Boolean(workspace),
				execNotes,
				signal: controller.signal,
				title: input.prTitle ?? '',
				body: input.prBody ?? '',
				context: input.prContext ?? '',
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

		let setupNotes = '';
		if (workspace) {
			// The step covers waiting on the dependency install as well as the checks.
			events?.onStage?.('checks');
			const report = await setup;
			const checks = (plan.checks ?? []).slice(0, REVIEW_POLICY.maxBaselineChecks);
			const baseline = await runBaselineChecks(checks, evidence, controller.signal, events, task);
			setupNotes = describeSandbox(report, baseline);
		}

		events?.onStage?.('specialists');
		await runAssignmentPool(
			plan.assignments,
			assignments,
			{
				inventory,
				evidence,
				coverage,
				budget,
				deadlineAt: investigationDeadline,
				signal: controller.signal,
				events,
				task,
				candidates,
				nextCandidate: () => `c${nextCandidate++}`,
				recommended,
				followUps,
				exec: Boolean(workspace),
				setupNotes
			}
		);
		publishCoverage();
		publishBudget();
		events?.onCandidates?.(candidates.filter((candidate) => candidate.valid).length);

		if (
			followUps.length > 0 &&
			canLaunchInvestigation(investigationDeadline, budget) &&
			assignments.length < REVIEW_POLICY.maxInitialAssignments + REVIEW_POLICY.maxFollowUpAssignments
		) {
			const extra = await selectFollowUps(followUps, inventory, evidence, budget, investigationDeadline, controller.signal, events);
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
					deadlineAt: investigationDeadline,
					signal: controller.signal,
					events,
					task,
					candidates,
					nextCandidate: () => `c${nextCandidate++}`,
					recommended,
					followUps: [],
					exec: Boolean(workspace),
					setupNotes
				});
			}
		}

		budget.reserve = REVIEW_POLICY.reserveCallsForConsolidation;
		if (candidates.some((candidate) => candidate.valid)) {
			if (workspace) events?.onStage?.('verify');
			await verifyCandidates(candidates.filter((candidate) => candidate.valid), {
				evidence,
				budget,
				deadlineAt,
				signal: controller.signal,
				events,
				task,
				setupNotes,
				unavailable: workspace ? null : execReason
			});
			publishBudget();
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
		} else if (!budget.canSpend(1, { consumeReserve: true }) || reviewNow() >= deadlineAt) {
			unconfirmed = valid;
			outcome = 'partial';
			error = 'Reserved consolidation call was unavailable';
			task('consolidation', 'Consolidating findings', 'error', error, { kind: 'consolidation' });
		} else {
			try {
				const cfg = configForOrchestrator();
				const result = await runJsonAgent({
					label: 'consolidation',
					getDiscussion: () => events?.getDiscussion?.() ?? '',
					onMessage: (message) => events?.onMessage?.({ ...message, assignmentId: '__pipeline', model: cfg.model }),
					system: withGuidelines(consolidationSystemPrompt(), inventory.guidelines),
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
					onLog: (message) => events?.onLog?.(message),
					onReasoning: (reasoning) =>
						events?.onReasoning?.({ ...reasoning, role: 'correctness', model: cfg.model }),
					onTool: (tool) => events?.onTool?.({ ...tool, role: 'correctness' })
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
		if (workspace) {
			// Stop an install still running after an early exit, then clean up.
			controller.abort();
			await workspace.cleanup().catch(() => undefined);
		}
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
	exec: boolean;
	execNotes?: string;
	signal: AbortSignal;
	title: string;
	body: string;
	context?: string;
	events?: HarnessEvents;
	task: (id: string, label: string, status: ReviewTask['status'], message: string, extra?: Partial<ReviewTask>) => void;
}): Promise<{ plan: PlannerOutput; degraded: boolean }> {
	const cfg = configForOrchestrator();
	if (!canLaunchInvestigation(input.deadlineAt, input.budget)) {
		return { plan: fallbackPlan(input.inventory, 'No model budget remained for planning.'), degraded: true };
	}
	const result = await runJsonAgent({
		label: 'planner',
		getDiscussion: () => input.events?.getDiscussion?.() ?? '',
		onMessage: (message) => input.events?.onMessage?.({ ...message, assignmentId: '__pipeline', model: cfg.model }),
		system: withGuidelines(plannerSystemPrompt(input.exec), input.inventory.guidelines),
		user: plannerUserPrompt({ title: input.title, body: input.body, context: input.context, inventory: input.inventory, execNotes: input.execNotes }),
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
		onLog: (message) => input.events?.onLog?.(message, { role: 'correctness' }),
		onReasoning: (reasoning) =>
			input.events?.onReasoning?.({ ...reasoning, role: 'correctness', model: cfg.model }),
		onTool: (tool) => input.events?.onTool?.({ ...tool, role: 'correctness' })
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
	const cfg = configForOrchestrator();
	const result = await runJsonAgent({
		label: 'follow-up planning',
		getDiscussion: () => events?.getDiscussion?.() ?? '',
		onMessage: (message) => events?.onMessage?.({ ...message, assignmentId: '__pipeline', model: cfg.model }),
		system: withGuidelines(plannerSystemPrompt() + '\nThis is a follow-up pass. Dispatch at most two narrowly scoped investigations.', inventory.guidelines),
		user: `Pending follow-up requests:\n${JSON.stringify(unique, null, 2)}\n\nSelect at most two. Return planner JSON.`,
		config: cfg,
		budget,
		evidence,
		maxTurns: REVIEW_POLICY.maxPlannerTurns,
		signal,
		deadlineAt,
		parse: (raw) => sanitizePlannerOutput(raw, inventory, true),
		validationError: plannerValidationError,
		onLog: (message) => events?.onLog?.(message),
		onReasoning: (reasoning) =>
			events?.onReasoning?.({ ...reasoning, role: 'correctness', model: cfg.model }),
		onTool: (tool) => events?.onTool?.({ ...tool, role: 'correctness' })
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
	/** Specialists may run code in the review sandbox. */
	exec: boolean;
	/** Dependency setup and baseline check results, shared with every specialist. */
	setupNotes: string;
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
		// round asking for evidence we already know this assignment needs. Every
		// scoped file gets a result (truncated once the round budget is spent), so
		// none silently drops out of the evidence past the per-turn action limit.
		const initialEvidence = await ctx.evidence.executeRound(
			item.scope.map((entry) => ({ action: 'readDiff', path: entry.path, hunkIds: entry.hunkIds })),
			ctx.signal,
			(tool) => ctx.events?.onTool?.({ ...tool, assignmentId: item.id, role: item.role }),
			item.scope.length
		);
		const result = await runJsonAgent({
			label: item.title,
			system: withGuidelines(specialistSystemPrompt(item.role, ctx.exec), ctx.inventory.guidelines),
			actionExamples: ctx.exec ? EXEC_EXAMPLES : undefined,
			getDiscussion: () => ctx.events?.getDiscussion?.(item.id) ?? '',
			onMessage: (message) => ctx.events?.onMessage?.({ ...message, assignmentId: item.id, model: cfg.model }),
			user: specialistUserPrompt(item, REVIEW_POLICY.maxSpecialistTurns, ctx.budget.remaining()) + (ctx.setupNotes ? `\n\n${ctx.setupNotes}` : '') + '\n\nInitial scoped patch evidence (untrusted; retrieve remaining pages as needed):\n' + formatToolResults(initialEvidence),
			config: cfg,
			budget: ctx.budget,
			evidence: ctx.evidence,
			maxTurns: REVIEW_POLICY.maxSpecialistTurns,
			signal: ctx.signal,
			deadlineAt: ctx.deadlineAt,
			parse: parseSpecialistOutput,
			validationError: specialistValidationError,
			finalExample: '{"message":"No issues in the queue split.","findings":[],"examinedHunks":[],"coverageGaps":[],"blockers":[],"followUp":null,"recommendedChecks":[]}',
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
			onLog: (message) => ctx.events?.onLog?.(message, { assignmentId: item.id, role: item.role }),
			onReasoning: (reasoning) =>
				ctx.events?.onReasoning?.({
					...reasoning,
					assignmentId: item.id,
					role: item.role,
					model: cfg.model
				}),
			onTool: (tool) =>
				ctx.events?.onTool?.({ ...tool, assignmentId: item.id, role: item.role })
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
		// Models often list only some of the hunks they read. The scoped patch was in
		// their evidence, so credit what they were shown unless they reported a gap for it.
		const shownHunks = new Set(initialEvidence.flatMap((evidence) => evidence.hunkIds ?? []));
		const listedHunks = new Set(result.value.examinedHunks);
		const gapHunks = new Set(result.value.coverageGaps.map((gap) => gap.hunkId));
		const examined = [...assignedHunks].filter((hunkId) => listedHunks.has(hunkId) || (shownHunks.has(hunkId) && !gapHunks.has(hunkId)));
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

/**
 * The repo layer of owner guidelines, read at the PR's base ("target") commit:
 * a pull request that edits the file does not change its own review.
 */
async function loadRepoGuidelines(evidence: EvidenceStore, signal: AbortSignal, onTool?: HarnessEvents['onTool']): Promise<GuidelinesInput['repo']> {
	if (!evidence.revision) return null;
	try {
		const [path] = await evidence.existingFiles('target', [GUIDELINES_PATH], signal);
		if (!path) return null;
		const lines = REVIEW_POLICY.maxReadLines;
		const results = await evidence.executeRound([
			{ action: 'readFile', revision: 'target', path, startLine: 1, endLine: lines },
			{ action: 'readFile', revision: 'target', path, startLine: lines + 1, endLine: lines * 2 }
		], signal, onTool);
		const content = results
			.filter((result) => result.ok)
			.map((result) => result.content.split('\n').map((line) => line.replace(/^\d+\|/, '')).join('\n'))
			.join('\n');
		if (!content.trim()) return null;
		return { content, path, ref: evidence.revision.targetRef || undefined, sha: evidence.revision.targetSha || undefined };
	} catch {
		return null;
	}
}

async function loadGuidance(inventory: ReviewInventory, evidence: EvidenceStore, signal: AbortSignal, onTool?: HarnessEvents['onTool']): Promise<void> {
	if (!evidence.revision) return;
	const paths = await evidence.existingFiles('target', INSTRUCTION_PATHS, signal);
	const reads = paths.map((path) => ({ action: 'readFile' as const, revision: 'target', path, startLine: 1, endLine: 80 }));
	for (let i = 0; i < reads.length; i += REVIEW_POLICY.maxRetrievalsPerTurn) {
		const results = await evidence.executeRound(reads.slice(i, i + REVIEW_POLICY.maxRetrievalsPerTurn), signal, onTool);
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
			signal,
			onTool
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

type TaskFn = (id: string, label: string, status: ReviewTask['status'], message: string, extra?: Partial<ReviewTask>) => void;

interface BaselineResult {
	command: string;
	evidenceId?: string;
	exitCode: number | null;
	output: string;
	error?: string;
}

/** Install dependencies in the sandbox, reported as tool rows so the developer sees the commands and output. */
async function installDependencies(workspace: ExecWorkspace, signal: AbortSignal, events: HarnessEvents | undefined, task: TaskFn): Promise<SetupReport> {
	task('setup', 'Install dependencies', 'running', 'Installing dependencies in the sandbox', { kind: 'setup' });
	let seq = 0;
	let toolId = '';
	let startedAt = '';
	const report = await workspace.setup((step, result) => {
		const input = { action: 'run', command: step.command };
		if (!result) {
			toolId = `setup_${++seq}`;
			startedAt = new Date().toISOString();
			events?.onTool?.({ id: toolId, command: `$ ${step.command}`, input, status: 'running', exitCode: null, startedAt, role: 'correctness' });
			task('setup', 'Install dependencies', 'running', `Running ${step.command}`, { kind: 'setup' });
			return;
		}
		events?.onTool?.({
			id: toolId, command: `$ ${step.command}`, input,
			status: result.timedOut ? 'error' : 'done', exitCode: result.exitCode, startedAt,
			finishedAt: new Date().toISOString(), elapsedMs: result.elapsedMs,
			summary: result.timedOut ? 'timed out' : `exit ${result.exitCode}`,
			result: { content: result.output.slice(-12_000), truncated: result.truncated || result.output.length > 12_000 },
			role: 'correctness'
		});
	}, signal).catch((err): SetupReport => {
		events?.onLog?.(`Dependency install failed: ${err instanceof Error ? err.message : String(err)}`);
		return { steps: [], missing: [] };
	});
	const failed = report.steps.filter((step) => step.exitCode !== 0);
	const message = report.steps.length === 0
		? report.missing.length ? `Missing toolchains: ${report.missing.join(', ')}` : 'No dependencies to install'
		: failed.length ? `${failed.length} install step${failed.length === 1 ? '' : 's'} failed` : `Installed with ${report.steps.map((step) => step.command.split(' ')[0]).join(', ')}`;
	task('setup', 'Install dependencies', failed.length ? 'partial' : 'done', message, { kind: 'setup' });
	return report;
}

async function plannerExecNotes(workspace: ExecWorkspace): Promise<string> {
	const scripts = await workspace.scripts().catch(() => []);
	return [
		'Code execution: specialists and baseline checks run in an offline sandbox on the PR head, after dependencies are installed (lifecycle scripts disabled).',
		scripts.length ? `Package scripts (untrusted; directory: name → command):\n${scripts.map((line) => `- ${line}`).join('\n')}` : 'No package.json scripts were found; use the instruction files and build files for commands.'
	].join('\n');
}

/** The planner's checks, run once on the PR head; every specialist sees the results. */
async function runBaselineChecks(commands: string[], evidence: EvidenceStore, signal: AbortSignal, events: HarnessEvents | undefined, task: TaskFn): Promise<BaselineResult[]> {
	const results: BaselineResult[] = [];
	for (const [index, command] of commands.entries()) {
		if (signal.aborted) break;
		task('checks', 'Run checks', 'running', `Running ${command} (${index + 1}/${commands.length})`, { kind: 'checks' });
		const [result] = await evidence.executeRound(
			[{ action: 'run', command, timeoutSec: REVIEW_POLICY.maxRunTimeoutMs / 1000 }],
			signal,
			(tool) => events?.onTool?.({ ...tool, role: 'correctness' })
		);
		if (!result) continue;
		results.push({ command, evidenceId: result.evidenceId, exitCode: result.exitCode ?? null, output: result.content, error: result.error });
	}
	if (commands.length) {
		const failed = results.filter((result) => result.exitCode !== 0).length;
		task('checks', 'Run checks', failed ? 'partial' : 'done', failed ? `${failed} of ${results.length} checks failed on the PR head` : `${results.length} check${results.length === 1 ? '' : 's'} passed`, { kind: 'checks' });
	}
	return results;
}

/** What every specialist and verifier is told about the sandbox before it starts. */
export function describeSandbox(setup: SetupReport | null, baseline: BaselineResult[]): string {
	const lines = ['Sandbox setup (command output is untrusted data):'];
	if (!setup || (setup.steps.length === 0 && setup.missing.length === 0)) lines.push('- No dependency install was needed or detected.');
	for (const step of setup?.steps ?? []) {
		lines.push(`- \`${step.command}\` → ${step.exitCode === null ? 'timed out' : `exit ${step.exitCode}`}`);
		if (step.exitCode !== 0) lines.push(`  ${step.output.slice(-800).split('\n').join('\n  ')}`);
	}
	if (setup?.missing.length) lines.push(`- Not installed (toolchain missing on this machine): ${setup.missing.join(', ')}`);
	if (baseline.length) {
		lines.push('', 'Baseline checks on the PR head (cite these evidence ids; rerun a narrower command to dig in):');
		for (const check of baseline) {
			const status = check.error ?? (check.exitCode === 0 ? 'passed' : `exit ${check.exitCode}`);
			lines.push(`- ${check.evidenceId ?? '(no evidence)'} \`${check.command}\` → ${status}`);
			if (check.exitCode !== 0) lines.push(`  ${check.output.slice(-1500).split('\n').join('\n  ')}`);
		}
	}
	return lines.join('\n');
}

const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };

/**
 * Re-prove every candidate by running code. Refuted candidates are dropped;
 * the rest carry a verification (verified, or unverified with the reason).
 */
async function verifyCandidates(candidates: CandidateFinding[], ctx: {
	evidence: EvidenceStore;
	budget: ModelBudget;
	deadlineAt: number;
	signal: AbortSignal;
	events?: HarnessEvents;
	task: TaskFn;
	setupNotes: string;
	/** Why code cannot run in this review; null when it can. */
	unavailable: string | null;
}): Promise<void> {
	if (ctx.unavailable) {
		for (const candidate of candidates) candidate.verification = { status: 'unverified', reason: `Not run: ${ctx.unavailable}` };
		return;
	}
	const queue = [...candidates].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));
	for (const skipped of queue.splice(REVIEW_POLICY.maxVerifications)) {
		skipped.verification = { status: 'unverified', reason: `Not run: this review already verified ${REVIEW_POLICY.maxVerifications} findings.` };
	}
	let cursor = 0;
	const workers = Array.from({ length: Math.min(REVIEW_POLICY.maxConcurrentVerifications, queue.length) }, async () => {
		while (cursor < queue.length) {
			const candidate = queue[cursor++]!;
			if (ctx.signal.aborted || !canLaunchInvestigation(ctx.deadlineAt, ctx.budget)) {
				candidate.verification = { status: 'unverified', reason: 'Not run: the review ran out of time or model calls before verifying this.' };
				continue;
			}
			await verifyOne(candidate, ctx);
		}
	});
	await Promise.all(workers);
	ctx.events?.onCandidates?.(candidates.filter((candidate) => candidate.valid).length);
}

async function verifyOne(candidate: CandidateFinding, ctx: Parameters<typeof verifyCandidates>[1]): Promise<void> {
	const role = (candidate.agent ?? 'correctness') as ReviewRole;
	const cfg = configForRole(role);
	const taskId = `verify:${candidate.candidateId}`;
	const label = `Verify: ${candidate.title ?? candidate.file}`;
	const meta = { kind: 'verification' as const, agent: role, model: cfg.model, assignmentId: candidate.assignmentId, files: [candidate.file] };
	ctx.task(taskId, label, 'running', 'Reproducing the finding', meta);
	try {
		const result = await runJsonAgent({
			label: `verify ${candidate.candidateId}`,
			system: verifierSystemPrompt(),
			user: verifierUserPrompt(candidate, ctx.evidence, ctx.setupNotes),
			actionExamples: EXEC_EXAMPLES,
			finalExample: '{"message":"The repro fails on an empty bucket.","verdict":"confirmed","reason":"`bun test src/recoder-repro.test.ts` fails: refill() returns NaN for an empty bucket.","evidenceIds":["ev_7"]}',
			config: cfg,
			budget: ctx.budget,
			evidence: ctx.evidence,
			maxTurns: REVIEW_POLICY.maxVerifierTurns,
			signal: ctx.signal,
			deadlineAt: ctx.deadlineAt,
			parse: parseVerdict,
			validationError: verdictValidationError,
			getDiscussion: () => ctx.events?.getDiscussion?.(candidate.assignmentId) ?? '',
			// Verification is shown in the conversation of the specialist who raised the finding.
			onMessage: (message) => ctx.events?.onMessage?.({ ...message, assignmentId: candidate.assignmentId ?? '__pipeline', model: cfg.model }),
			onProgress: (state, elapsedMs, detail) =>
				ctx.task(taskId, label, state === 'queued' ? 'waiting' : 'running', state === 'retrieval' ? 'Running code' : detail, { ...meta, elapsedMs }),
			onLog: (message) => ctx.events?.onLog?.(message, { assignmentId: candidate.assignmentId, role }),
			onReasoning: (reasoning) => ctx.events?.onReasoning?.({ ...reasoning, assignmentId: candidate.assignmentId, role, model: cfg.model }),
			onTool: (tool) => ctx.events?.onTool?.({ ...tool, assignmentId: candidate.assignmentId, role })
		});
		if (!result.value) {
			candidate.verification = { status: 'unverified', reason: `Not verified: ${result.error ?? 'the verifier did not finish'}.` };
			ctx.task(taskId, label, 'partial', 'Could not verify', meta);
			return;
		}
		const settled = settleVerdict(result.value, ctx.evidence);
		if (settled === 'refuted') {
			candidate.valid = false;
			candidate.dropReason = `refuted by running code: ${result.value.reason}`;
			ctx.task(taskId, label, 'done', 'Disproved by a run; dropped', meta);
			return;
		}
		candidate.verification = settled;
		if (settled.status === 'verified') {
			// The proving run leads the evidence, so the finding opens on its output.
			const proof = result.value.evidenceIds.filter((id) => ctx.evidence.get(id)?.kind === 'run');
			candidate.evidenceIds = [...new Set([...proof, ...(candidate.evidenceIds ?? [])])];
		}
		ctx.task(taskId, label, 'done', settled.status === 'verified' ? 'Verified by a run' : 'Could not prove by running code', meta);
	} catch (err) {
		if (err instanceof AuthConfigError || err instanceof ReviewAbortedError) throw err;
		candidate.verification = { status: 'unverified', reason: `Not verified: ${err instanceof Error ? err.message : 'verification failed'}.` };
		ctx.task(taskId, label, 'error', 'Verification failed', meta);
	}
}

/** "2 verified by running code, 1 unverified." — empty when nothing was checked. */
function verifiedSummary(findings: Finding[]): string {
	const verified = findings.filter((finding) => finding.verification?.status === 'verified').length;
	const unverified = findings.filter((finding) => finding.verification?.status === 'unverified').length;
	if (!verified && !unverified) return '';
	return [verified ? `${verified} verified by running code` : '', unverified ? `${unverified} unverified` : ''].filter(Boolean).join(', ') + '.';
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
	const incomplete = input.assignments.filter((assignment) => assignment.status !== 'done');
	const bits = [
		`${input.outcome === 'complete' ? 'Review complete' : 'Review incomplete'}. ${input.confirmed.length} confirmed finding${input.confirmed.length === 1 ? '' : 's'}.`,
		verifiedSummary(input.confirmed),
		input.unconfirmed.length ? `${input.unconfirmed.length} candidate${input.unconfirmed.length === 1 ? '' : 's'} could not be confirmed.` : '',
		incomplete.length ? `${incomplete.length} specialist review${incomplete.length === 1 ? '' : 's'} did not finish.` : '',
		input.coverage.partial + input.coverage.pending > 0 ? 'Some changes still need review.' : ''
	];
	return bits.filter(Boolean).join(' ');
}
