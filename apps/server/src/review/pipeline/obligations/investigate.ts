import type { Obligation, ObligationAnswer, ReviewAssignment } from '@recoder/shared';
import type { EvidenceRecord } from '../../../evidence/evidence.js';
import { withModelTally, type ModelTally } from '../../../models/metrics.js';
import { configForSubagent, type ModelConfig } from '../../../models/models.js';
import type { ExecWorkspace } from '../../../sandbox/exec-workspace.js';
import { withGuidelines } from '../../guidelines/guidelines.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import { ModelBlockedError, runJsonAgent } from '../agent-loop.js';
import { newAgentId } from '../agent-loop/limits.js';
import {
	agentEvents,
	failAssignment,
	queueAssignment,
	readScopedPatch,
	unitPrompt,
	type PoolContext,
	type ScopedPatch
} from '../harness/pool.js';
import { addCandidates, finishUnit } from '../harness/unit-result.js';
import { runOnBaseline } from '../harness/verify-baseline.js';
import { investigatorSystemPrompt } from '../reviewer-prompts.js';
import type { ReviewUnit } from '../units.js';
import {
	INVESTIGATOR_EXAMPLE,
	investigatorResponseSchema,
	investigatorValidationError,
	parseInvestigatorOutput,
	type InvestigatorOutput
} from './answer.js';
import { investigatorRole } from './prompts.js';
import { WorkClock } from './work-clock.js';

/** Model turns an investigation may take; a few, since it answers one question. */
export const OBLIGATION_TURNS = 6;

/** How often the time box is checked against the review clock. */
const TICK_MS = 250;

/** A base rerun needs at least this much of the box left to be worth starting. */
const MIN_BASE_RUN_MS = 1_000;

/** What an investigation needs beyond a reviewer's pool context. */
export interface InvestigationContext extends PoolContext {
	timeBoxMs: number;
	obligationOf: (unitId: string) => Obligation;
	/** The sandbox and merge base a counterexample is rerun on; either null when code cannot run there. */
	workspace: ExecWorkspace | null;
	mergeBaseSha: string | null;
	/** Records an investigation's answer before its assignment is marked finished. */
	onAnswer: (answer: ObligationAnswer) => void;
}

/** What an answer records about the investigation's cost and limits rather than its findings. */
type Spent = 'elapsedMs' | 'queuedMs' | 'workingMs' | 'turns' | 'tokens' | 'timeBoxMs' | 'launched';

type Settled = Omit<ObligationAnswer, 'obligationId' | Spent>;

/** An answer with no investigation behind it: nothing found, tried or cited. */
export function blankAnswer(result: ObligationAnswer['result'], reason: string): Settled {
	return {
		contractEvidence: [],
		inputPartition: [],
		expectedBehavior: '',
		attemptedCounterexample: null,
		result,
		reason,
		evidenceIds: []
	};
}

/**
 * Runs one obligation's investigation on the second model through the
 * reviewer pool's machinery, inside its time box, and records the answer. The
 * box measures working time: it stops while the investigation's sandbox calls
 * wait behind other agents' calls, and the review deadline stays the hard
 * stop. A confirmed answer publishes its finding as an ordinary candidate,
 * which the verifier then proves or refutes. Running out of the box, a failed
 * model call or an answer that claims a defect it never ran leaves the answer
 * unresolved; a blocked model or a stopped review ends the review as usual.
 */
export async function investigate(item: ReviewUnit, records: ReviewAssignment[], ctx: InvestigationContext) {
	const obligation = ctx.obligationOf(item.id);
	const cfg = configForSubagent();
	const agentId = newAgentId();
	const clock = new WorkClock();
	const unwatch = ctx.workspace?.watchQueue(agentId, clock);
	const box = new AbortController();
	const outOfBox = () => clock.workingMs() >= ctx.timeBoxMs;
	const timer = setInterval(() => outOfBox() && box.abort(), TICK_MS);
	const boxed = { ...ctx, signal: AbortSignal.any([ctx.signal, box.signal]) };
	const tally: ModelTally = { calls: 0, outputTokens: null };
	const outOfTime = `No answer within the ${Math.round(ctx.timeBoxMs / 1000)} s time box`;

	const record = (settled: Settled) =>
		ctx.onAnswer({
			obligationId: obligation.id,
			...settled,
			...clock.reading(),
			turns: tally.calls,
			tokens: tally.outputTokens,
			timeBoxMs: ctx.timeBoxMs,
			launched: true
		});

	queueAssignment(item, records, ctx, cfg.model);

	try {
		const patch = await readScopedPatch(item, 'obligation', boxed);

		const result = await withModelTally(tally, () =>
			askInvestigator(item, records, boxed, { obligation, cfg, patch, agentId, clock })
		);

		const reason = box.signal.aborted || outOfBox() ? outOfTime : result.error;

		const settled = result.value
			? await settle(result.value, boxed, agentId, ctx.timeBoxMs - clock.workingMs())
			: blankAnswer('unresolved', reason ?? 'The investigator gave no answer');

		const candidateId = settled.result === 'confirmed' ? publish(item, ctx, cfg.model, result.value!, settled) : null;

		record(candidateId ? { ...settled, candidateId } : settled);
		finishUnit(item, records, ctx, cfg.model, () => `Finished · ${settled.result}`);
	} catch (err) {
		if (err instanceof ModelBlockedError || ctx.signal.aborted) throw err;

		const reason = box.signal.aborted ? outOfTime : err instanceof Error ? err.message : 'Investigation failed';

		record(blankAnswer('unresolved', reason));
		failAssignment(item, records, ctx, cfg.model, reason);
	} finally {
		clearInterval(timer);
		unwatch?.();
	}
}

/** The investigator's model loop: the reviewer contract and its procedure, a few turns, inside the box. */
function askInvestigator(
	item: ReviewUnit,
	records: ReviewAssignment[],
	ctx: InvestigationContext,
	agent: { obligation: Obligation; cfg: ModelConfig; patch: ScopedPatch; agentId: string; clock: WorkClock }
) {
	const { obligation, cfg, patch, agentId, clock } = agent;
	const role = investigatorRole(obligation, ctx.exec, Math.round(ctx.timeBoxMs / 1000));

	return runJsonAgent<InvestigatorOutput>({
		label: item.title,
		agentId,
		system: withGuidelines(investigatorSystemPrompt(ctx.exec, ctx.directive, role), ctx.inventory.guidelines),
		exec: ctx.exec,
		user: unitPrompt(item, ctx, OBLIGATION_TURNS, 'Obligation', patch),
		config: cfg,
		budget: ctx.budget,
		evidence: ctx.evidence,
		maxTurns: OBLIGATION_TURNS,
		signal: ctx.signal,
		deadlineAt: ctx.deadlineAt,
		parse: parseInvestigatorOutput,
		validationError: investigatorValidationError,
		checkFinal: (value, state) =>
			ctx.exec && value.answer.result === 'confirmed' && state.runs === 0
				? 'You confirmed a defect without running the counterexample. Write it as a scratch script or test and run it now: reply with "actions". If it cannot run, answer "unresolved".'
				: null,
		responseSchema: (finalTurn) => investigatorResponseSchema(ctx.exec, finalTurn),
		timeLimit: {
			finalTurnAfterMs: Math.round((ctx.timeBoxMs * 2) / 3),
			maxWallMs: ctx.timeBoxMs,
			elapsed: () => clock.workingMs()
		},
		finalExample: INVESTIGATOR_EXAMPLE,
		...agentEvents(item, records, ctx, cfg.model)
	});
}

/** The runs this investigator made, oldest first. */
function ownRuns(ctx: InvestigationContext, agentId: string): EvidenceRecord[] {
	return [...ctx.evidence.records.values()].filter((record) => record.kind === 'run' && record.agentId === agentId);
}

/**
 * The fixed record for a parsed answer. Its counterexample is the run it
 * cites when the investigator made it, else its latest run, and that command
 * is rerun once on the merge-base tree with the `left` of the box. When code
 * can run, a defect confirmed without any run of its own stays unresolved.
 */
async function settle(
	value: InvestigatorOutput,
	ctx: InvestigationContext,
	agentId: string,
	left: number
): Promise<Settled> {
	const { answer, output } = value;
	const runs = ownRuns(ctx, agentId);
	const proof = runs.find((run) => run.id === answer.attemptedCounterexample?.evidenceId) ?? runs.at(-1) ?? null;
	const baseCtx = { ...ctx, deadlineAt: () => ctx.deadlineAt };
	const timeoutMs = Math.min(REVIEW_POLICY.baseRunTimeoutMs, left);

	const base = !proof
		? null
		: left < MIN_BASE_RUN_MS
			? { unavailable: 'the time box ran out' }
			: await runOnBaseline(proof.id, answer.reason, baseCtx, agentId, timeoutMs);

	const tried = answer.attemptedCounterexample;
	const cited = [tried?.evidenceId, ...output.findings.flatMap((finding) => finding.evidenceIds)];
	const unproved = ctx.exec && answer.result === 'confirmed' && !proof;

	return {
		contractEvidence: answer.contractEvidence,
		inputPartition: answer.inputPartition,
		expectedBehavior: answer.expectedBehavior,
		attemptedCounterexample:
			tried || proof
				? {
						input: tried?.input ?? '',
						command: proof?.command ?? null,
						evidenceId: proof?.id ?? null,
						observed: tried?.observed ?? '',
						...(base ? { base } : {})
					}
				: null,
		result: unproved ? 'unresolved' : answer.result,
		reason: unproved
			? `Confirmed without running a counterexample, so nothing was published. ${answer.reason}`
			: answer.reason,
		evidenceIds: [...new Set([...runs.map((run) => run.id), ...cited])].filter(
			(id): id is string => typeof id === 'string' && ctx.evidence.get(id) !== undefined
		)
	};
}

/**
 * A confirmed answer's findings as ordinary candidates on the obligation's
 * assignment, each citing the counterexample run; returns the first one's id.
 */
function publish(
	item: ReviewUnit,
	ctx: InvestigationContext,
	model: string,
	value: InvestigatorOutput,
	settled: Settled
): string | null {
	const proof = settled.attemptedCounterexample?.evidenceId;

	const findings = value.output.findings.map((finding) =>
		proof && !finding.evidenceIds.includes(proof)
			? { ...finding, evidenceIds: [...finding.evidenceIds, proof] }
			: finding
	);

	addCandidates(item, 'obligation', ctx, model, { ...value.output, findings });

	return ctx.candidates.find((candidate) => candidate.assignmentId === item.id)?.candidateId ?? null;
}
