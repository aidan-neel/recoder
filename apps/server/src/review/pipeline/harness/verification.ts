import type { EvidenceStore } from '../../../evidence/evidence.js';
import { configForSubagent } from '../../../models/models.js';
import { reviewNow } from '../../session/review-control.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import {
	ModelBlockedError,
	ReviewAbortedError,
	canLaunchInvestigation,
	newAgentId,
	runJsonAgent,
	type ModelBudget
} from '../agent-loop.js';
import type { CandidateFinding } from '../consolidate.js';
import { EXEC_EXAMPLES } from '../prompts.js';
import {
	parseVerdict,
	settleVerdict,
	verdictValidationError,
	verifierRanNothing,
	verifierResponseSchema,
	verifierSystemPrompt,
	verifierUserPrompt,
	type VerdictOutput
} from '../verify.js';
import { publishBudget, saveCheckpoint, syncWorkspaceDeadline, type ReviewRun } from './context.js';
import type { HarnessEvents, TaskFn } from './types.js';

interface VerifyContext {
	evidence: EvidenceStore;
	budget: ModelBudget;
	deadlineAt: number;
	signal: AbortSignal;
	events?: HarnessEvents;
	task: TaskFn;
	setupNotes: string;
	/** Why code cannot run in this review; null when it can. */
	unavailable: string | null;
	/** Called after each verdict, to save a checkpoint. */
	onVerified?: () => void;
}

/** A verifier that errors or stops before a verdict runs once more, after every candidate's first attempt. */
const VERIFIER_ATTEMPTS = 2;

const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };

const VERIFIER_EXAMPLE =
	'{"message":"The repro fails on an empty bucket.","verdict":"confirmed","reason":"`bun test src/recoder-repro.test.ts` fails: refill() returns NaN for an empty bucket.","evidenceIds":["ev_7"]}';

/**
 * The verify stage. Every valid candidate a resumed review hasn't already
 * verified gets a verifier, so the budget and deadline grow to make room for all of them.
 */
export async function verifyStage(run: ReviewRun): Promise<void> {
	const { budget } = run;

	budget.reserve = REVIEW_POLICY.reserveCallsForConsolidation;

	const unverified = run.candidates.filter((candidate) => candidate.valid && !candidate.verification);

	if (!unverified.length) return;

	run.events?.onStage?.('verify');

	const toVerify = Math.min(unverified.length, REVIEW_POLICY.maxVerifications);

	budget.limit = Math.max(
		budget.limit,
		budget.used + toVerify * REVIEW_POLICY.maxVerifierTurns + REVIEW_POLICY.reserveCallsForConsolidation
	);

	run.deadlineAt = Math.max(
		run.deadlineAt,
		reviewNow() +
			Math.ceil(toVerify / REVIEW_POLICY.maxConcurrentVerifications) * REVIEW_POLICY.msPerVerificationWave +
			REVIEW_POLICY.reserveMsForConsolidation
	);

	syncWorkspaceDeadline(run);
	publishBudget(run);

	await verifyCandidates(unverified, {
		evidence: run.evidence,
		budget,
		deadlineAt: run.deadlineAt,
		signal: run.controller.signal,
		events: run.events,
		task: run.task,
		setupNotes: run.setupNotes,
		unavailable: run.workspace ? null : run.execReason,
		onVerified: () => saveCheckpoint(run)
	});

	publishBudget(run);
}

/**
 * Re-prove every candidate by running code, most severe first. Refuted candidates
 * are dropped; the rest carry a verification (verified, or unverified with the reason).
 * A verifier that errors or stops before a verdict gets one more attempt at the
 * back of the queue, so a retry only spends what's left after every candidate had its first.
 */
async function verifyCandidates(candidates: CandidateFinding[], ctx: VerifyContext): Promise<void> {
	const sorted = [...candidates].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));

	for (const skipped of sorted.splice(REVIEW_POLICY.maxVerifications)) {
		skipped.verification = {
			status: 'unverified',
			reason: `Not run: this review already verified ${REVIEW_POLICY.maxVerifications} findings.`
		};
	}

	const queue = sorted.map((candidate) => ({ candidate, attempt: 1 }));
	let cursor = 0;

	const workers = Array.from({ length: Math.min(REVIEW_POLICY.maxConcurrentVerifications, queue.length) }, async () => {
		while (cursor < queue.length) {
			const { candidate, attempt } = queue[cursor++]!;

			if (ctx.signal.aborted || !canLaunchInvestigation(ctx.deadlineAt, ctx.budget)) {
				if (attempt === 1)
					candidate.verification = {
						status: 'unverified',
						reason: 'Not run: the review ran out of time or model calls before verifying this.'
					};

				continue;
			}

			const settled = await verifyOne(candidate, ctx, attempt);

			if (!settled && attempt < VERIFIER_ATTEMPTS) queue.push({ candidate, attempt: attempt + 1 });
			ctx.onVerified?.();
		}
	});

	await Promise.all(workers);
	ctx.events?.onCandidates?.(candidates.filter((candidate) => candidate.valid).length);
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
	const doing = ctx.unavailable ? 'Tracing the finding through the code' : 'Reproducing the finding';

	const meta = {
		kind: 'verification' as const,
		agent: candidate.agent ?? 'reviewer',
		model: configForSubagent().model,
		assignmentId: candidate.assignmentId,
		files: [candidate.file]
	};

	ctx.task(taskId, label, 'running', attempt > 1 ? `${doing}, second attempt` : doing, meta);

	const outcome = await runVerifier(candidate, ctx, { taskId, label, meta });

	if (typeof outcome !== 'string') {
		settle(candidate, outcome, ctx, { taskId, label, meta });

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
	ctx: VerifyContext,
	{ taskId, label, meta }: VerifierTask
): Promise<{ value: VerdictOutput; agentId: string } | string> {
	const cfg = configForSubagent();
	const exec = !ctx.unavailable;
	const owner = { assignmentId: taskId, role: 'verifier' };
	const agentId = newAgentId();

	try {
		const result = await runJsonAgent({
			label: `verify ${candidate.candidateId}`,
			agentId,
			system: verifierSystemPrompt(ctx.unavailable),
			user: verifierUserPrompt(candidate, ctx.evidence, ctx.setupNotes),
			actionExamples: exec ? EXEC_EXAMPLES : undefined,
			checkFinal: exec ? verifierRanNothing : undefined,
			timeLimit: { finalTurnAfterMs: REVIEW_POLICY.verifierFinalTurnAfterMs, maxWallMs: REVIEW_POLICY.verifierMaxMs },
			responseSchema: (finalTurn) => verifierResponseSchema(exec, finalTurn),
			finalExample: VERIFIER_EXAMPLE,
			config: cfg,
			budget: ctx.budget,
			evidence: ctx.evidence,
			maxTurns: REVIEW_POLICY.maxVerifierTurns,
			signal: ctx.signal,
			deadlineAt: ctx.deadlineAt,
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

/** Apply a verdict: a refuted candidate is dropped, any other carries its verification. */
function settle(
	candidate: CandidateFinding,
	{ value, agentId }: { value: VerdictOutput; agentId: string },
	ctx: VerifyContext,
	{ taskId, label, meta }: VerifierTask
): void {
	const settled = settleVerdict(value, ctx.evidence, agentId);

	if (settled === 'refuted') {
		candidate.valid = false;
		candidate.dropReason = `refuted by running code: ${value.reason}`;
		ctx.task(taskId, label, 'done', 'Disproved by a run; dropped', meta);

		return;
	}

	candidate.verification = settled;
	if (settled.status === 'verified') leadWithProof(candidate, value.evidenceIds, ctx.evidence, agentId);

	ctx.task(
		taskId,
		label,
		'done',
		settled.status !== 'verified'
			? 'Could not prove it'
			: settled.method === 'run'
				? 'Verified by a run'
				: 'Traced through the code',
		meta
	);
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
