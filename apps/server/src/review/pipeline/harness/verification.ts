import { findingKind, type FindingVerification } from '@recoder/shared';
import type { EvidenceStore } from '../../../evidence/evidence.js';
import type { ExecWorkspace } from '../../../sandbox/exec-workspace.js';
import type { RuleLedger } from '../../guidelines/ledger/types.js';
import { configForVerifier, type ModelConfig } from '../../../models/models.js';
import { REVIEW_POLICY, verifierTurns } from '../../session/review-policy.js';
import { ModelBlockedError, ReviewAbortedError, newAgentId, runJsonAgent, type ModelBudget } from '../agent-loop.js';
import { isHeldBack, isPublishable, publishHeldBack, type CandidateFinding } from '../consolidate.js';
import type { ChangeIntent } from '../intent/types.js';
import { intentBlock } from '../intent/format.js';
import type { ReviewInventory } from '../inventory.js';
import {
	examplesOnDisk,
	precheckRuleCandidate,
	qualityVerifierPushBack,
	qualityVerifierSystemPrompt,
	qualityVerifierUserPrompt,
	refuteByRuleScope,
	settleQualityVerdict
} from '../quality-verify.js';
import {
	coveredByIntent,
	parseVerdict,
	settleVerdict,
	verdictValidationError,
	verifierResponseSchema,
	verifierSystemPrompt,
	verifierPushBack,
	verifierUserPrompt,
	withOutcome,
	type VerdictOutput,
	type VerifierNotes
} from '../verify.js';
import { isMutationFinding } from '../verify/runs.js';
import { publishBudget, publishCandidates, type ReviewRun } from './context.js';
import { checkPatches } from './patch-check.js';
import type { BackgroundChecks } from './sandbox-setup.js';
import type { HarnessEvents, TaskFn } from './types.js';
import { candidateRepairOn, repairCandidate } from './repair.js';
import { diffChanges, type DiffChanges } from './run-outcome.js';
import { recordBaseline } from './verify-baseline.js';
import { finishVerifierTask, settledLabel, verifierTask, type VerifierTask } from './verification-task.js';
import { VerifyQueue } from './verify-queue.js';
import { needsVerifierFallback } from '../verify/full-fallback.js';
import { compactVerifierOn, compactVerifierSource, type VerifierSpec } from '../verify/compact.js';
import { dependencyApiSource, dependencyGroundingOn } from '../verify/dependency-api.js';

interface VerifyContext {
	evidence: EvidenceStore;
	budget: ModelBudget;
	/** The review deadline as it stands; it moves as candidates join and checks finish. */
	deadlineAt: () => number;
	signal: AbortSignal;
	events?: HarnessEvents;
	task: TaskFn;
	/** Read when a verifier starts, so one that starts after the baseline checks sees their results. */
	notes: () => VerifierNotes;
	intent: ChangeIntent | null;
	ledger: RuleLedger | null;
	inventory: ReviewInventory;
	/** The PR checkout, where convention examples are looked up; null without one. */
	checkout: string | null;
	/** Why bugs in this review are not run, known once the sandbox shows whether the code runs; null when it does. */
	cannotRun: () => Promise<string | null>;
	/** The review's sandbox, where a run-proved bug is run again on the merge-base tree; null when code cannot run. */
	workspace: ExecWorkspace | null;
	mergeBaseSha: string | null;
	/** What the diff added and removed, which a failed base run is checked against. */
	changes: () => DiffChanges;
}

const VERIFIER_EXAMPLE =
	'{"message":"The repro fails on an empty bucket.","verdict":"confirmed","reason":"The repro test fails with `expect(received).toBe(expected): received NaN` because refill() divides by the size of an empty bucket at `src/limiter.ts:42`.","evidenceIds":["ev_7"],"expected":"The repro fails with NaN when the bucket is empty."}';

/**
 * Opens the review's verifier queue before the reviewers start, so each
 * candidate is verified as soon as its reviewer reports it, or once its one
 * repair makes a rejected candidate valid. Candidates a resumed review hasn't
 * verified join at once. `sandbox` resolves when the sandbox is prepared,
 * which may be after the reviewers started.
 */
export function startVerification(run: ReviewRun, sandbox: Promise<BackgroundChecks>): void {
	const ctx: VerifyContext = {
		evidence: run.evidence,
		budget: run.budget,
		deadlineAt: () => run.deadlineAt,
		signal: run.controller.signal,
		events: run.events,
		task: run.task,
		notes: () => ({
			sharedSetupNotes: run.sharedSetupNotes,
			setupNotes: run.setupNotes,
			intent: intentBlock(run.intent),
			skills: run.skills
		}),
		intent: run.intent,
		ledger: run.ledger,
		inventory: run.inventory,
		checkout: run.input.revision?.checkoutPath ?? null,
		cannotRun: whyCodeCannotRun(run, sandbox),
		workspace: run.workspace,
		mergeBaseSha: run.input.revision?.mergeBaseSha ?? null,
		changes: () => diffChanges(run.inventory, run.changeModel)
	};

	const repair = candidateRepairOn() ? (candidate: CandidateFinding) => repairCandidate(run, candidate) : undefined;

	const queue = new VerifyQueue(
		run,
		(candidate, attempt, verifierId) => verifyOne(candidate, ctx, attempt, verifierId),
		repair,
		(follower, leader, verifierId) => shareVerdict(follower, leader, ctx, verifierId)
	);

	run.verifying = queue;

	for (const candidate of run.candidates) queue.add(candidate);
}

/**
 * A verifier can only prove a bug where the repository's own code runs, so a
 * review runs bugs only when one baseline check (type check, lint or tests)
 * passed or ran passing tests (`ranCode` in `baseline-run.ts`), or when
 * package prep's smoke run reached its assertions. Asked once and the answer
 * is kept. It comes as soon as the sandbox shows the code running: when the
 * smoke run reached its assertions, or with the first check that ran, not
 * after the slowest one.
 */
function whyCodeCannotRun(run: ReviewRun, sandbox: Promise<BackgroundChecks>): () => Promise<string | null> {
	let answer: Promise<string | null> | undefined;

	const decide = async (): Promise<string | null> => {
		if (!run.workspace) return `code cannot run in this review (${run.execReason ?? 'no sandbox'})`;

		const checks = await sandbox;

		if (!checks.commands.length) return 'no type check, lint or test command was found to run here';
		if (run.smokeReached || (await checks.ranCode)) return null;

		return `none of this repository's checks passed here (${checks.commands.join(', ')})`;
	};

	return () => (answer ??= decide());
}

/** Enters the foreground verification stage and waits for every verifier queued so far. */
export async function drainVerification(run: ReviewRun): Promise<void> {
	run.verifying?.enterStage();
	await run.verifying?.drain();
}

/**
 * The end of verification, once the reviewers and detectors are done. After
 * the last verdict, verified quality findings get their suggested patches
 * checked, and whatever is not verified is hidden.
 */
export async function finishVerification(run: ReviewRun): Promise<void> {
	await run.verifying?.drain();

	publishCandidates(run);
	publishBudget(run);

	await checkPatches(run);
	hideUnproven(run);
}

/**
 * Every verification gets its outcome, however it was settled. Unproven
 * candidates are never shown; they are kept so the summary and evals can count
 * them. A candidate held back for being below the reporting bar is not unproven
 * but out of scope, so it is not among them, and neither is a bug no verifier
 * could run.
 */
export function hideUnproven(run: ReviewRun): void {
	for (const candidate of run.candidates) {
		if (candidate.verification) candidate.verification = withOutcome(candidate.verification);
	}

	run.hidden = run.candidates.filter(
		(candidate) => candidate.valid && !isHeldBack(candidate) && !isPublishable(candidate)
	);
}

/** Bugs are reproduced by running code; quality findings are checked by reading and searching. */
function verifierSpec(candidate: CandidateFinding, ctx: VerifyContext, firstAttempt: boolean): VerifierSpec {
	if (findingKind(candidate.category) === 'quality') {
		const rule = ctx.ledger?.rules.find((entry) => entry.id === candidate.ruleId);

		return {
			system: qualityVerifierSystemPrompt(),
			user: qualityVerifierUserPrompt(candidate, ctx.evidence, { ...ctx.notes(), rule }),
			exec: false,
			mutation: false,
			turns: verifierTurns(false)
		};
	}

	const mutation = isMutationFinding(candidate, true);
	const turns = verifierTurns(mutation);
	const compact = firstAttempt && !mutation && compactVerifierOn();

	return {
		system: verifierSystemPrompt(mutation, compact),
		user: verifierUserPrompt(candidate, ctx.evidence, ctx.notes(), turns, compact),
		exec: true,
		mutation,
		turns,
		compact
	};
}

/** Stamps the verifier's model and reasoning effort onto a settled verification. */
function stampedVerification(verification: FindingVerification, cfg: ModelConfig): FindingVerification {
	return {
		...verification,
		model: cfg.model,
		...(cfg.reasoningEffort ? { effort: cfg.reasoningEffort } : {})
	};
}

/**
 * A report of an issue a verifier already proved takes that proof instead of
 * a verifier of its own; consolidation merges the two into one finding. The
 * leader's runs lead its evidence, as a verifier's own proof would.
 */
function shareVerdict(
	follower: CandidateFinding,
	leader: CandidateFinding,
	ctx: VerifyContext,
	verifierId?: string
): string {
	const row = verifierTask(follower, leader.verification?.model, verifierId);
	const proof = (leader.evidenceIds ?? []).filter((id) => ctx.evidence.get(id)?.kind === 'run');

	delete follower.publishedBy;
	follower.verification = { ...leader.verification! };
	if (leader.ruleCheck) follower.ruleCheck = leader.ruleCheck;
	follower.evidenceIds = [...new Set([...proof, ...(follower.evidenceIds ?? [])])];
	publishHeldBack(follower, ctx.ledger);

	return finishVerifierTask(ctx.task, row, `Verified with "${leader.title ?? leader.file}"`);
}

/**
 * One attempt at settling a candidate. The queue can retry when there is no
 * verdict, leaving the candidate unverified with the reason. Its thinking, tools
 * and messages are its own (owned by its task), so they show in the Verify step
 * rather than in the thread that raised the finding.
 */
async function verifyOne(
	candidate: CandidateFinding,
	ctx: VerifyContext,
	attempt: number,
	verifierId: string
): Promise<{ message: string; retry?: true }> {
	const cfg = configForVerifier();
	const row = verifierTask(candidate, cfg.model, verifierId);
	const { taskId, label, meta } = row;

	const notRun = findingKind(candidate.category) === 'quality' ? null : await ctx.cannotRun();

	if (notRun) {
		candidate.verification = { status: 'unverified', outcome: 'not-run', reason: `Not verified: ${notRun}.` };

		return { message: finishVerifierTask(ctx.task, row, 'Not run: the code cannot run here') };
	}

	const spec = { ...verifierSpec(candidate, ctx, attempt === 1), toolOpBudget: attempt > 1 ? null : undefined };

	delete candidate.publishedBy;

	const rulePrecheck = precheckRuleCandidate(candidate, ctx.ledger, ctx.inventory);

	if (rulePrecheck) {
		refuteByRuleScope(candidate, rulePrecheck);

		return { message: finishVerifierTask(ctx.task, row, 'Rule does not apply; dropped') };
	}

	const doing = !spec.exec ? 'Tracing the finding through the code' : 'Reproducing the finding';

	if (candidate.category === 'convention' && !(await examplesOnDisk(ctx.checkout, candidate.examples))) {
		candidate.verification = { status: 'unverified', reason: 'The examples it cites are not in the repository.' };

		return { message: finishVerifierTask(ctx.task, row, 'Examples not found') };
	}

	ctx.task(taskId, label, 'running', attempt > 1 ? `${doing}, second attempt` : doing, meta);

	const agentId = newAgentId();

	try {
		const outcome = await runVerifier(candidate, spec, ctx, cfg, { taskId, label, meta, agentId });

		if (typeof outcome !== 'string') {
			const message = await settle(candidate, outcome, ctx, cfg, row);

			if (!needsVerifierFallback(candidate, outcome.budgetExhausted || spec.compact)) return { message };
		} else {
			candidate.verification = stampedVerification({ status: 'unverified', reason: `Not verified: ${outcome}.` }, cfg);
		}
	} finally {
		ctx.workspace?.release(agentId);
	}

	const message = 'Could not verify';

	ctx.task(taskId, label, 'partial', message, meta);

	return { message, retry: true };
}

interface VerifierRunOutcome {
	budgetExhausted?: boolean;
	value: VerdictOutput;
	agentId: string;
	retrievals: number;
}

/** One verifier run: its verdict and the agent that gave it, or why it gave none. */
async function runVerifier(
	candidate: CandidateFinding,
	{ system, user, exec, mutation, turns, toolOpBudget, compact }: VerifierSpec,
	ctx: VerifyContext,
	cfg: ModelConfig,
	{ taskId, label, meta, agentId }: VerifierTask & { agentId: string }
): Promise<VerifierRunOutcome | string> {
	const owner = { assignmentId: taskId, role: 'verifier' };
	let retrievals = 0;

	try {
		const grounded =
			exec && !mutation && dependencyGroundingOn()
				? await dependencyApiSource(candidate, ctx.workspace, user, ctx.signal)
				: user;

		const result = await runJsonAgent({
			toolOpBudget,
			stage: 'verifier',
			label: `verify ${candidate.candidateId}`,
			agentId,
			system,
			user: compact ? await compactVerifierSource(candidate, ctx.evidence, grounded, ctx.signal) : grounded,
			exec,
			checkFinal: exec
				? (value, state) => verifierPushBack(value, state, ctx.evidence, agentId, mutation)
				: (value, state) => qualityVerifierPushBack(candidate, value, state, ctx.evidence, ctx.ledger),
			timeLimit: { finalTurnAfterMs: REVIEW_POLICY.verifierFinalTurnAfterMs, maxWallMs: REVIEW_POLICY.verifierMaxMs },
			responseSchema: (finalTurn) => verifierResponseSchema(exec, finalTurn),
			finalExample: VERIFIER_EXAMPLE,
			config: cfg,
			budget: ctx.budget,
			evidence: ctx.evidence,
			maxTurns: turns,
			signal: ctx.signal,
			deadlineAt: ctx.deadlineAt(),
			parse: parseVerdict,
			validationError: verdictValidationError,
			getDiscussion: async () => (await ctx.events?.getDiscussion?.(candidate.assignmentId)) ?? '',
			onMessage: (message) => ctx.events?.onMessage?.({ ...message, assignmentId: taskId, model: cfg.model }),
			onProgress: (state, elapsedMs, detail) => {
				if (state === 'retrieval') retrievals++;

				ctx.task(
					taskId,
					label,
					state === 'queued' ? 'waiting' : 'running',
					state === 'retrieval' ? (exec ? 'Running code' : 'Reading code') : state === 'running' ? 'Thinking' : detail,
					{ ...meta, elapsedMs }
				);
			},
			onLog: (message) => ctx.events?.onLog?.(message, owner),
			onReasoning: (reasoning) => ctx.events?.onReasoning?.({ ...reasoning, ...owner, model: cfg.model }),
			onTool: (tool) => ctx.events?.onTool?.({ ...tool, ...owner })
		});

		return result.value
			? { value: result.value, agentId, retrievals, budgetExhausted: result.opBudgetExhausted }
			: (result.error ?? 'the verifier did not finish');
	} catch (err) {
		if (err instanceof ModelBlockedError || err instanceof ReviewAbortedError) throw err;

		return err instanceof Error ? err.message : 'verification failed';
	}
}

/**
 * A verdict as the candidate's verification, or `refuted`. A bug is also
 * refuted when a stated non-goal or a stacked pull request covers it.
 */
function verdictFor(
	candidate: CandidateFinding,
	{ value, agentId, retrievals }: VerifierRunOutcome,
	ctx: VerifyContext
) {
	if (findingKind(candidate.category) === 'quality') {
		return settleQualityVerdict(candidate, value, ctx.evidence, {
			ledger: ctx.ledger,
			inventory: ctx.inventory,
			retrievals
		});
	}

	if (coveredByIntent(value, ctx.intent)) return 'refuted' as const;

	return settleVerdict(value, ctx.evidence, agentId, isMutationFinding(candidate, true));
}

/**
 * Apply a verdict: a refuted candidate is dropped, any other carries its
 * verification. A bug proved by a run is run once more on the merge-base tree.
 */
async function settle(
	candidate: CandidateFinding,
	outcome: VerifierRunOutcome,
	ctx: VerifyContext,
	cfg: ModelConfig,
	row: VerifierTask
): Promise<string> {
	const { value, agentId } = outcome;
	const settled = verdictFor(candidate, outcome, ctx);

	if (settled === 'refuted') {
		candidate.valid = false;
		candidate.refuted = true;
		candidate.dropStage = value.coveredBy ? 'covered' : 'refuted';

		candidate.dropReason = value.coveredBy
			? `covered by ${value.coveredBy}: ${value.reason}`
			: `refuted by the verifier: ${value.reason}`;

		candidate.verification = stampedVerification(
			{ status: 'unverified', outcome: 'refuted', reason: candidate.dropReason },
			cfg
		);

		return finishVerifierTask(
			ctx.task,
			row,
			value.coveredBy ? `Covered by ${value.coveredBy}; dropped` : 'Disproved; dropped'
		);
	}

	const baseline = isMutationFinding(candidate, true) ? settled : await recordBaseline(settled, ctx, agentId);

	candidate.verification = stampedVerification(baseline, cfg);
	publishHeldBack(candidate, ctx.ledger);
	if (settled.status === 'verified') leadWithProof(candidate, value.evidenceIds, ctx.evidence, agentId);

	return finishVerifierTask(ctx.task, row, settledLabel(settled));
}

/** The proving runs lead the candidate's evidence, so the finding opens on their output. */
function leadWithProof(
	candidate: CandidateFinding,
	evidenceIds: string[],
	evidence: EvidenceStore,
	agentId: string
): void {
	const proof = evidenceIds.filter((id) => {
		const record = evidence.get(id);

		return record?.kind === 'run' && record.agentId === agentId;
	});

	candidate.evidenceIds = [...new Set([...proof, ...(candidate.evidenceIds ?? [])])];
}
