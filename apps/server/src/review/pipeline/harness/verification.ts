import { findingKind, type FindingVerification } from '@recoder/shared';
import type { EvidenceStore } from '../../../evidence/evidence.js';
import type { ExecWorkspace } from '../../../sandbox/exec-workspace.js';
import type { RuleLedger } from '../../guidelines/ledger/types.js';
import { configForSubagent } from '../../../models/models.js';
import { REVIEW_POLICY, verifierTurns } from '../../session/review-policy.js';
import { ModelBlockedError, ReviewAbortedError, newAgentId, runJsonAgent, type ModelBudget } from '../agent-loop.js';
import { candidateFromDetector, isHeldBack, publishHeldBack, type CandidateFinding } from '../consolidate.js';
import type { DetectorResult } from '../detectors/types.js';
import type { ChangeIntent } from '../intent/types.js';
import { intentBlock } from '../intent/format.js';
import {
	examplesOnDisk,
	qualityVerifierSystemPrompt,
	qualityVerifierUserPrompt,
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
import type { HarnessEvents, TaskFn } from './types.js';
import { candidateRepairOn, repairCandidate } from './repair.js';
import { diffChanges, type DiffChanges } from './run-outcome.js';
import { recordBaseline } from './verify-baseline.js';
import { VerifyQueue } from './verify-queue.js';

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
	/** The PR checkout, where convention examples are looked up; null without one. */
	checkout: string | null;
	/** Why code cannot run in this review; null when it can. */
	unavailable: string | null;
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
 * verified join at once.
 */
export function startVerification(run: ReviewRun): void {
	const ctx: VerifyContext = {
		evidence: run.evidence,
		budget: run.budget,
		deadlineAt: () => run.deadlineAt,
		signal: run.controller.signal,
		events: run.events,
		task: run.task,
		notes: () => ({ setupNotes: run.setupNotes, intent: intentBlock(run.intent) }),
		intent: run.intent,
		ledger: run.ledger,
		checkout: run.input.revision?.checkoutPath ?? null,
		unavailable: run.workspace ? null : run.execReason,
		workspace: run.workspace,
		mergeBaseSha: run.input.revision?.mergeBaseSha ?? null,
		changes: () => diffChanges(run.inventory, run.changeModel)
	};

	const repair = candidateRepairOn() ? (candidate: CandidateFinding) => repairCandidate(run, candidate) : undefined;
	const queue = new VerifyQueue(run, (candidate, attempt) => verifyOne(candidate, ctx, attempt), repair);

	run.verifying = queue;

	for (const candidate of run.candidates) queue.add(candidate);
}

/**
 * Detector results join as candidates already proven by the check that found
 * them, except suspected ones, which get a verifier like any other. One a
 * resumed review already holds is not added twice.
 */
export function addDetections(run: ReviewRun, results: DetectorResult[]): void {
	const ctx = { inventory: run.inventory, evidence: run.evidence, changeModel: run.changeModel, ledger: run.ledger };

	for (const result of results) {
		const candidate = candidateFromDetector(result, { candidateId: `c${run.nextCandidate}` }, ctx);

		if (run.candidates.some((held) => sameDetection(held, candidate))) continue;

		run.nextCandidate++;
		run.candidates.push(candidate);
		run.verifying?.add(candidate);
	}

	publishCandidates(run);
}

function sameDetection(held: CandidateFinding, candidate: CandidateFinding): boolean {
	return (
		held.agent === candidate.agent &&
		held.file === candidate.file &&
		held.line === candidate.line &&
		held.title === candidate.title
	);
}

/** Resolves once every verifier queued so far has finished. */
export async function drainVerification(run: ReviewRun): Promise<void> {
	if (run.verifying?.busy) run.events?.onStage?.('verify');

	await run.verifying?.drain();
}

/**
 * The end of verification, once the reviewers and detectors are done. After
 * the last verdict, verified quality findings get their suggested patches
 * checked, and whatever is not verified is hidden.
 */
export async function finishVerification(run: ReviewRun): Promise<void> {
	await drainVerification(run);

	publishCandidates(run);
	publishBudget(run);

	await checkPatches(run);
	hideUnproven(run);
}

/**
 * Every verification gets its outcome, however it was settled. Unproven
 * candidates are never shown; they are kept so the summary and evals can count
 * them. A candidate held back for being below the reporting bar is not unproven
 * but out of scope, so it is not among them.
 */
export function hideUnproven(run: ReviewRun): void {
	for (const candidate of run.candidates) {
		if (candidate.verification) candidate.verification = withOutcome(candidate.verification);
	}

	run.hidden = run.candidates.filter(
		(candidate) => candidate.valid && !isHeldBack(candidate) && candidate.verification?.status !== 'verified'
	);
}

/** How one candidate is verified: the prompts, and whether its verifier may run code. */
interface VerifierSpec {
	system: string;
	user: string;
	exec: boolean;
	/** A weak-test finding, settled by planting the bug the test should catch. */
	mutation: boolean;
	/** The verifier's turn limit, the last of which is its final answer. */
	turns: number;
}

/** Bugs are reproduced by running code when it can run; quality findings are checked by reading and searching. */
function verifierSpec(candidate: CandidateFinding, ctx: VerifyContext): VerifierSpec {
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

	const mutation = isMutationFinding(candidate, !ctx.unavailable);
	const turns = verifierTurns(mutation);

	return {
		system: verifierSystemPrompt(ctx.unavailable, mutation),
		user: verifierUserPrompt(candidate, ctx.evidence, ctx.notes(), turns),
		exec: !ctx.unavailable,
		mutation,
		turns
	};
}

/**
 * One attempt at settling a candidate. Returns false when the verifier gave no
 * verdict, leaving the candidate unverified with the reason. Its thinking, tools
 * and messages are its own (owned by its task), so they show in the Verify step
 * rather than in the thread that raised the finding.
 */
async function verifyOne(candidate: CandidateFinding, ctx: VerifyContext, attempt: number): Promise<boolean> {
	const taskId = `verify:${candidate.candidateId}`;
	const label = `Verify: ${candidate.title ?? candidate.file}`;
	const spec = verifierSpec(candidate, ctx);

	delete candidate.publishedBy;

	const doing = !spec.exec ? 'Tracing the finding through the code' : 'Reproducing the finding';

	const meta = {
		kind: 'verification' as const,
		agent: candidate.agent ?? 'reviewer',
		model: configForSubagent().model,
		assignmentId: candidate.assignmentId,
		files: [candidate.file]
	};

	if (candidate.category === 'convention' && !(await examplesOnDisk(ctx.checkout, candidate.examples))) {
		candidate.verification = { status: 'unverified', reason: 'The examples it cites are not in the repository.' };
		ctx.task(taskId, label, 'done', 'Examples not found', meta);

		return true;
	}

	ctx.task(taskId, label, 'running', attempt > 1 ? `${doing}, second attempt` : doing, meta);

	const outcome = await runVerifier(candidate, spec, ctx, { taskId, label, meta });

	if (typeof outcome !== 'string') {
		await settle(candidate, outcome, ctx, { taskId, label, meta });

		return true;
	}

	candidate.verification = { status: 'unverified', reason: `Not verified: ${outcome}.` };
	ctx.task(taskId, label, 'partial', 'Could not verify', meta);

	return false;
}

interface VerifierTask {
	taskId: string;
	label: string;
	meta: Parameters<TaskFn>[4];
}

/** One verifier run: its verdict and the agent that gave it, or why it gave none. */
async function runVerifier(
	candidate: CandidateFinding,
	{ system, user, exec, mutation, turns }: VerifierSpec,
	ctx: VerifyContext,
	{ taskId, label, meta }: VerifierTask
): Promise<{ value: VerdictOutput; agentId: string } | string> {
	const cfg = configForSubagent();
	const owner = { assignmentId: taskId, role: 'verifier' };
	const agentId = newAgentId();

	try {
		const result = await runJsonAgent({
			label: `verify ${candidate.candidateId}`,
			agentId,
			system,
			user,
			exec,
			checkFinal: exec ? (value, state) => verifierPushBack(value, state, ctx.evidence, agentId, mutation) : undefined,
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
			getDiscussion: () => ctx.events?.getDiscussion?.(candidate.assignmentId) ?? '',
			onMessage: (message) => ctx.events?.onMessage?.({ ...message, assignmentId: taskId, model: cfg.model }),
			onProgress: (state, elapsedMs, detail) =>
				ctx.task(
					taskId,
					label,
					state === 'queued' ? 'waiting' : 'running',
					state === 'retrieval' ? (exec ? 'Running code' : 'Reading code') : state === 'queued' ? detail : 'Thinking',
					{ ...meta, elapsedMs }
				),
			onLog: (message) => ctx.events?.onLog?.(message, owner),
			onReasoning: (reasoning) => ctx.events?.onReasoning?.({ ...reasoning, ...owner, model: cfg.model }),
			onTool: (tool) => ctx.events?.onTool?.({ ...tool, ...owner })
		});

		return result.value ? { value: result.value, agentId } : (result.error ?? 'the verifier did not finish');
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
	{ value, agentId }: { value: VerdictOutput; agentId: string },
	ctx: VerifyContext
) {
	if (findingKind(candidate.category) === 'quality') return settleQualityVerdict(candidate, value, ctx.evidence);
	if (coveredByIntent(value, ctx.intent)) return 'refuted' as const;

	return settleVerdict(value, ctx.evidence, agentId, isMutationFinding(candidate, !ctx.unavailable));
}

/**
 * Apply a verdict: a refuted candidate is dropped, any other carries its
 * verification. A bug proved by a run is run once more on the merge-base tree.
 */
async function settle(
	candidate: CandidateFinding,
	outcome: { value: VerdictOutput; agentId: string },
	ctx: VerifyContext,
	{ taskId, label, meta }: VerifierTask
): Promise<void> {
	const { value, agentId } = outcome;
	const settled = verdictFor(candidate, outcome, ctx);

	if (settled === 'refuted') {
		candidate.valid = false;
		candidate.refuted = true;
		candidate.dropStage = value.coveredBy ? 'covered' : 'refuted';

		candidate.dropReason = value.coveredBy
			? `covered by ${value.coveredBy}: ${value.reason}`
			: `refuted by the verifier: ${value.reason}`;

		ctx.task(
			taskId,
			label,
			'done',
			value.coveredBy ? `Covered by ${value.coveredBy}; dropped` : 'Disproved; dropped',
			meta
		);

		return;
	}

	const baseline = isMutationFinding(candidate, !ctx.unavailable)
		? settled
		: await recordBaseline(settled, ctx, agentId);

	candidate.verification = baseline;
	publishHeldBack(candidate, ctx.ledger);
	if (settled.status === 'verified') leadWithProof(candidate, value.evidenceIds, ctx.evidence, agentId);

	ctx.task(taskId, label, 'done', settledLabel(settled), meta);
}

/** The task row's last word on a verification. */
function settledLabel(settled: FindingVerification): string {
	if (settled.status !== 'verified') return 'Could not prove it';
	if (settled.method === 'run') return 'Verified by a run';
	if (settled.method === 'rule') return 'Checked against the rule';
	if (settled.method === 'convention') return 'Checked against the repo';

	return 'Traced through the code';
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
