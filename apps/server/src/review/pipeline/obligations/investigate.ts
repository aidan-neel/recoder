import type { Obligation, ObligationAnswer, ReviewAssignment, VerificationBaseline } from '@recoder/shared';
import type { EvidenceRecord } from '../../../evidence/evidence.js';
import { withModelTally, type ModelTally } from '../../../models/metrics.js';
import { configForSubagent, type ModelConfig } from '../../../models/models.js';
import type { ExecWorkspace } from '../../../sandbox/exec-workspace.js';
import { withGuidelines } from '../../guidelines/guidelines.js';
import { reviewNow } from '../../session/review-control.js';
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
import type { DiffChanges } from '../harness/run-outcome.js';
import { addCandidates, finishUnit } from '../harness/unit-result.js';
import { runOnBaseline } from '../harness/verify-baseline.js';
import { investigatorSystemPrompt } from '../reviewer-prompts.js';
import type { ReviewUnit } from '../units.js';
import { failedOnTarget } from '../verify/runs.js';
import {
	INVESTIGATOR_EXAMPLE,
	investigatorResponseSchema,
	investigatorValidationError,
	parseInvestigatorOutput,
	type InvestigatorOutput
} from './answer.js';
import { investigatorRole } from './prompts.js';

/** The last turns of an investigation, on which tools are refused so it answers instead of running out. */
const ANSWER_TURNS = 2;

/** What an investigation needs beyond a reviewer's pool context. */
export interface InvestigationContext extends PoolContext {
	/** Model turns the investigation gets. */
	maxTurns: number;
	obligationOf: (unitId: string) => Obligation;
	/** The sandbox and merge base a counterexample is rerun on; either null when code cannot run there. */
	workspace: ExecWorkspace | null;
	mergeBaseSha: string | null;
	/** What the diff added and removed, which a failed base run is checked against. */
	changes: () => DiffChanges;
	/** Records an investigation's answer before its assignment is marked finished. */
	onAnswer: (answer: ObligationAnswer) => void;
}

type Settled = Omit<ObligationAnswer, 'obligationId' | 'turns' | 'elapsedMs' | 'tokens' | 'maxTurns' | 'launched'>;

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
 * reviewer pool's machinery, in its model turns, and records the answer. A
 * confirmed answer publishes its finding as an ordinary candidate, which the
 * verifier then proves or refutes. Running out of turns, a failed model call,
 * a confirmed answer its own run does not prove, or one whose every finding
 * is rejected leaves the answer unresolved and the assignment done; only the review's deadline and cancellation stop
 * it by the clock, and those end the review as usual, as does a blocked model.
 */
export async function investigate(item: ReviewUnit, records: ReviewAssignment[], ctx: InvestigationContext) {
	const obligation = ctx.obligationOf(item.id);
	const cfg = configForSubagent();
	const agentId = newAgentId();
	const started = reviewNow();
	const tally: ModelTally = { calls: 0, outputTokens: null };

	const record = (settled: Settled) =>
		ctx.onAnswer({
			obligationId: obligation.id,
			...settled,
			turns: tally.calls,
			elapsedMs: reviewNow() - started,
			tokens: tally.outputTokens,
			maxTurns: ctx.maxTurns,
			launched: true
		});

	queueAssignment(item, records, ctx, cfg.model);

	try {
		const patch = await readScopedPatch(item, 'obligation', ctx);

		const result = await withModelTally(tally, () =>
			askInvestigator(item, records, ctx, { obligation, cfg, patch, agentId })
		);

		const settled = result.value
			? await settle(result.value, ctx, agentId)
			: blankAnswer('unresolved', noAnswerReason(result.error, tally.calls, ctx.maxTurns));

		const answer = settled.result === 'confirmed' ? publish(item, ctx, cfg.model, result.value!, settled) : settled;

		record(answer);
		finishUnit(item, records, ctx, cfg.model, () => `Finished · ${answer.result}`);
	} catch (err) {
		if (err instanceof ModelBlockedError || ctx.signal.aborted) throw err;

		const reason = err instanceof Error ? err.message : 'Investigation failed';

		record(blankAnswer('unresolved', reason));
		failAssignment(item, records, ctx, cfg.model, reason);
	}
}

/** Why an investigation ended without an answer: its turns ran out, or the agent loop's own reason. */
function noAnswerReason(error: string | undefined, calls: number, maxTurns: number): string {
	if (calls >= maxTurns) return `No answer within ${maxTurns} turns${error ? ` (${error})` : ''}`;

	return error ?? 'The investigator gave no answer';
}

/** The investigator's model loop: the reviewer contract and its procedure, in its turns, the last ones without tools. */
function askInvestigator(
	item: ReviewUnit,
	records: ReviewAssignment[],
	ctx: InvestigationContext,
	agent: { obligation: Obligation; cfg: ModelConfig; patch: ScopedPatch; agentId: string }
) {
	const { obligation, cfg, patch, agentId } = agent;
	const role = investigatorRole(obligation, ctx.exec, { turns: ctx.maxTurns, answerTurns: ANSWER_TURNS });

	return runJsonAgent<InvestigatorOutput>({
		label: item.title,
		agentId,
		system: withGuidelines(investigatorSystemPrompt(ctx.exec, ctx.directive, role), ctx.inventory.guidelines),
		exec: ctx.exec,
		user: unitPrompt(item, ctx, ctx.maxTurns, 'Obligation', patch),
		config: cfg,
		budget: ctx.budget,
		evidence: ctx.evidence,
		maxTurns: ctx.maxTurns,
		answerTurns: ANSWER_TURNS,
		signal: ctx.signal,
		deadlineAt: ctx.deadlineAt,
		parse: parseInvestigatorOutput,
		validationError: investigatorValidationError,
		checkFinal: (value, state) =>
			ctx.exec && value.answer.result === 'confirmed' && state.runs === 0
				? 'You confirmed a defect without running the counterexample. Write it as a scratch script or test and run it now: reply with "actions". If it cannot run, answer "unresolved".'
				: null,
		responseSchema: (finalTurn) => investigatorResponseSchema(ctx.exec, finalTurn),
		finalExample: INVESTIGATOR_EXAMPLE,
		...agentEvents(item, records, ctx, cfg.model)
	});
}

/** The runs this investigator made, oldest first. */
function ownRuns(ctx: InvestigationContext, agentId: string): EvidenceRecord[] {
	return [...ctx.evidence.records.values()].filter((record) => record.kind === 'run' && record.agentId === agentId);
}

/**
 * The fixed record for a parsed answer. Its counterexample is the run of its
 * own that the investigator cites. When code can run, a confirmed answer must
 * prove its defect with that run, checked against the same command on the
 * merge-base tree; one that does not becomes unresolved and says why.
 */
async function settle(value: InvestigatorOutput, ctx: InvestigationContext, agentId: string): Promise<Settled> {
	const { answer, output } = value;
	const runs = ownRuns(ctx, agentId);
	const tried = answer.attemptedCounterexample;
	const proof = runs.find((run) => run.id === tried?.evidenceId) ?? null;

	const checked =
		ctx.exec && answer.result === 'confirmed' ? await checkProof(proof, answer.reason, ctx, agentId) : null;

	const cited = [tried?.evidenceId, ...output.findings.flatMap((finding) => finding.evidenceIds)];

	return {
		contractEvidence: answer.contractEvidence,
		inputPartition: answer.inputPartition,
		expectedBehavior: answer.expectedBehavior,
		attemptedCounterexample: tried
			? {
					input: tried.input,
					command: proof?.command ?? null,
					evidenceId: proof?.id ?? null,
					observed: tried.observed,
					...(checked?.base ? { base: checked.base } : {})
				}
			: null,
		result: checked?.failure ? 'unresolved' : answer.result,
		reason: checked?.failure ? `${checked.failure} ${answer.reason}` : answer.reason,
		evidenceIds: [...new Set([...runs.map((run) => run.id), ...cited])].filter(
			(id): id is string => typeof id === 'string' && ctx.evidence.get(id) !== undefined
		)
	};
}

/**
 * Whether a confirmed answer's cited run proves a defect: it failed on the
 * code under test, or it ends differently on the merge-base tree, where it is
 * rerun once. `failure` says why it does not; `base` is that rerun.
 */
async function checkProof(
	proof: EvidenceRecord | null,
	reason: string,
	ctx: InvestigationContext,
	agentId: string
): Promise<{ base: VerificationBaseline | null; failure: string | null }> {
	if (!proof) {
		return {
			base: null,
			failure: 'Confirmed without citing a counterexample run of its own, so nothing was published.'
		};
	}

	const base = await runOnBaseline(proof.id, reason, { ...ctx, deadlineAt: () => ctx.deadlineAt }, agentId);

	if (failedOnTarget(proof) || (base && 'differs' in base && base.differs)) return { base, failure: null };

	const there = !base
		? 'could not be compared with the merge base'
		: 'unavailable' in base
			? `could not be rerun on the merge base (${base.unavailable})`
			: 'ends the same way on the merge base';

	return {
		base,
		failure: `Its counterexample \`${proof.command}\` exited ${proof.exitCode} and ${there}, so it shows no defect and nothing was published.`
	};
}

/**
 * A confirmed answer's findings as ordinary candidates on the obligation's
 * assignment, each citing the counterexample run, with the first valid one's
 * id. When validation rejects every finding the answer becomes unresolved.
 */
function publish(
	item: ReviewUnit,
	ctx: InvestigationContext,
	model: string,
	value: InvestigatorOutput,
	settled: Settled
): Settled {
	const proof = settled.attemptedCounterexample?.evidenceId;

	const findings = value.output.findings.map((finding) =>
		proof && !finding.evidenceIds.includes(proof)
			? { ...finding, evidenceIds: [...finding.evidenceIds, proof] }
			: finding
	);

	const before = ctx.candidates.length;

	addCandidates(item, 'obligation', ctx, model, { ...value.output, findings });

	const added = ctx.candidates.slice(before);
	const kept = added.find((candidate) => candidate.valid);

	if (kept) return { ...settled, candidateId: kept.candidateId };

	const why = [...new Set(added.map((candidate) => candidate.dropReason ?? 'rejected'))].join('; ');

	return {
		...settled,
		result: 'unresolved',
		reason: `Confirmed, but every finding was rejected (${why}), so nothing was published. ${settled.reason}`
	};
}
