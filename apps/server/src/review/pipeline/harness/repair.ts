import { configForOrchestrator } from '../../../models/models.js';
import { reviewNow } from '../../session/review-control.js';
import { ModelBlockedError, ReviewAbortedError, runJsonAgent } from '../agent-loop.js';
import {
	applyRepair,
	isRepairable,
	originalOf,
	planRepair,
	type CandidateRepair,
	type RepairChange,
	type RepairPlan,
	type RepairScope
} from '../candidate-repair.js';
import {
	REPAIR_SYSTEM,
	changesFromAnswer,
	nothingToOffer,
	repairAnswerSchema,
	repairOptions,
	repairPrompt,
	type RepairOptions
} from '../candidate-repair-model.js';
import type { CandidateContext, CandidateFinding } from '../consolidate.js';
import { orchestratorAgentOptions, publishCandidates, saveCheckpoint, type ReviewRun } from './context.js';

const DEFAULT_REPAIR_CAP = 8;

/** Whether a candidate that fails location or category validation gets its one repair; `RECODER_CANDIDATE_REPAIR=0` turns it off. */
export function candidateRepairOn(): boolean {
	return process.env.RECODER_CANDIDATE_REPAIR !== '0';
}

/** How many repairs one review makes at most (`RECODER_REPAIR_CAP`, default 8). */
function repairCap(): number {
	const raw = Number(process.env.RECODER_REPAIR_CAP);

	return Number.isInteger(raw) && raw >= 0 && process.env.RECODER_REPAIR_CAP !== '' ? raw : DEFAULT_REPAIR_CAP;
}

/** What validation reads from the run, as when the reviewer's findings first came in. */
function candidateContext(run: ReviewRun): CandidateContext {
	return {
		inventory: run.inventory,
		evidence: run.evidence,
		changeModel: run.changeModel,
		ledger: run.ledger,
		intent: run.intent,
		reportLowSeverity: run.input.reportLowSeverity ?? false,
		dismissed: new Set(run.dismissals.map((dismissal) => dismissal.fingerprint))
	};
}

/** Why the run can't spend a model call on a repair now, or null when it can. */
function cannotCall(run: ReviewRun): string | null {
	if (run.controller.signal.aborted) return 'the review was stopped';
	if (reviewNow() >= run.deadlineAt) return 'the review ran out of time';
	if (!run.budget.canSpend(1)) return 'the review ran out of model calls';

	return null;
}

/**
 * One model call that chooses what the diff left open, among lines the change
 * added and categories, claims and rules that exist. The changes, or why there
 * are none. The call shares the review's budget and may take up to the agent
 * loop's schema-repair turns on top of its one turn.
 */
async function askModel(
	run: ReviewRun,
	candidate: CandidateFinding,
	plan: RepairPlan,
	options: RepairOptions
): Promise<RepairChange[] | string> {
	const blocked = cannotCall(run);

	if (blocked) return blocked;

	const config = configForOrchestrator();

	try {
		const result = await runJsonAgent({
			label: `repair ${candidate.candidateId}`,
			...orchestratorAgentOptions(run, config),
			system: REPAIR_SYSTEM,
			user: repairPrompt(candidate, plan, options, run.evidence),
			maxTurns: 1,
			deadlineAt: run.deadlineAt,
			parse: (raw) => repairAnswerSchema.safeParse(raw).data ?? null,
			onLog: (message) => run.events?.onLog?.(message)
		});

		if (!result.value) return result.error ?? 'the model gave no answer';

		return changesFromAnswer(result.value, plan, options);
	} catch (err) {
		if (err instanceof ModelBlockedError || err instanceof ReviewAbortedError) throw err;

		return err instanceof Error ? err.message : 'the repair call failed';
	}
}

/** Records an attempt that changed nothing; the candidate keeps its original stop. */
function unchanged(candidate: CandidateFinding, result: CandidateRepair['result'], reason: string): CandidateRepair {
	return { original: originalOf(candidate), method: null, changes: [], result, reason };
}

/**
 * The repair itself: the diff's plan, one model call for what it left open,
 * then validation again. No call is made when an open choice has nothing to offer.
 */
async function attemptRepair(run: ReviewRun, candidate: CandidateFinding): Promise<CandidateRepair> {
	const scope: RepairScope = { inventory: run.inventory, ledger: run.ledger, intent: run.intent };
	const plan = planRepair(candidate, scope);

	if (plan.unsupported) return unchanged(candidate, 'unsupported', plan.unsupported);
	if (!plan.open.length) return applyRepair(candidate, plan.changes, 'deterministic', candidateContext(run));

	const options = repairOptions(candidate, plan, scope);
	const empty = nothingToOffer(plan, options);

	if (empty) return unchanged(candidate, 'unsupported', empty);

	const changes = await askModel(run, candidate, plan, options);

	if (typeof changes === 'string') return unchanged(candidate, 'unsupported', changes);

	return applyRepair(candidate, changes, 'model', candidateContext(run));
}

/**
 * Gives a candidate stopped at location or category validation its one repair,
 * within the review's cap. The cap counts attempts, is saved with the
 * checkpoint, and so holds when the review resumes. True when the repaired
 * candidate passed validation and should be verified.
 */
export async function repairCandidate(run: ReviewRun, candidate: CandidateFinding): Promise<boolean> {
	if (!isRepairable(candidate)) return false;

	if (run.repairs >= repairCap()) {
		candidate.repair = unchanged(candidate, 'not-run', `the review already made ${run.repairs} repairs`);

		return false;
	}

	run.repairs++;

	const repair = await attemptRepair(run, candidate);

	candidate.repair = repair;
	if (repair.result === 'revalidated') publishCandidates(run);
	saveCheckpoint(run);

	return repair.result === 'revalidated';
}
