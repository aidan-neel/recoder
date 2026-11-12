import {
	TOKEN_BUDGET_PLANS,
	budgetPatch,
	resolveEffort,
	type EffortChoices,
	type ReasoningEffort,
	type SubagentCap
} from '@recoder/shared';
import { savedReviewModelId } from '../../models/models.js';
import { getStoredSettings, setReviewOverrides } from '../../review/session/review-settings.js';
import type { ReviewTuning } from '../review/options.js';
import { namedModelChoices, savedModelChoices, type ModelLookup } from './model-choices.js';

/**
 * One model pick of the run: its id, the efforts it offers, and the effort saved for it. The choices are undefined
 * when they are unknown (a saved OpenCode or Devin pick its agent did not list, or could not list).
 */
interface RunPick {
	id: string | null;
	choices: EffortChoices | undefined;
	savedEffort: ReasoningEffort | null;
}

/** The subagents a review may run: the caller's count, else its budget's cap. An explicit 0 means none. */
export function subagentCapOf(tuning: Pick<ReviewTuning, 'budget' | 'subagents'>): SubagentCap | number {
	return tuning.subagents ?? TOKEN_BUDGET_PLANS[tuning.budget].subagentCap;
}

/**
 * Applies the run's model picks, efforts and file limit to the review settings in memory only; nothing is saved to the
 * user's settings file. Returns a function that puts the saved settings back. A model id the caller names that no
 * setup has throws a usage error before anything changes. Looking up an OpenCode or Devin model's efforts runs under
 * `lookup`, so it is bounded and stops with the run.
 */
export async function applyRunSettings(tuning: ReviewTuning, lookup: ModelLookup): Promise<() => void> {
	const saved = getStoredSettings();

	const orchestrator = await pickOf(lookup, {
		named: tuning.reviewerModel,
		savedId: savedReviewModelId(),
		savedEffort: saved.orchestratorEffort
	});

	const specialist = await pickOf(lookup, {
		named: tuning.workerModel,
		savedId: saved.specialistModelId,
		savedEffort: saved.specialistEffort
	});

	const verifier = await pickOf(lookup, {
		named: tuning.verifierModel,
		savedId: saved.verifierModelId,
		savedEffort: saved.verifierEffort
	});

	const budget = budgetPatch(tuning.budget, {
		orchestrator: orchestrator.choices,
		specialist: specialist.id ? specialist.choices : 'follows'
	});

	const verifierBudget = budgetPatch(tuning.budget, {
		orchestrator: orchestrator.choices,
		specialist: verifier.id ? verifier.choices : 'follows'
	});

	setReviewOverrides({
		...saved,
		...(tuning.reviewerModel ? { orchestratorModelId: tuning.reviewerModel } : {}),
		...(tuning.workerModel ? { specialistModelId: tuning.workerModel } : {}),
		...(tuning.verifierModel ? { verifierModelId: tuning.verifierModel } : {}),
		orchestratorEffort: effortOf(orchestrator, tuning.reviewerEffort, budget.orchestratorEffort),
		specialistEffort: specialist.id
			? effortOf(specialist, tuning.workerEffort, budget.specialistEffort)
			: (tuning.workerEffort ?? null),
		verifierEffort: verifier.id ? effortOf(verifier, null, verifierBudget.specialistEffort) : null,
		...(tuning.maxFileChars === null ? {} : { maxFileChars: tuning.maxFileChars })
	});

	return () => setReviewOverrides(saved);
}

/** One pick as the caller and the saved settings give it. */
interface PickSource {
	named: string | null;
	savedId: string | null | undefined;
	savedEffort: ReasoningEffort | null | undefined;
}

/** The id and efforts of one pick: a named id is checked against the setup, a saved one is read from it. */
async function pickOf(lookup: ModelLookup, source: PickSource): Promise<RunPick> {
	const { named, savedId, savedEffort } = source;

	if (named) return { id: named, choices: await namedModelChoices(named, lookup), savedEffort: null };

	return {
		id: savedId ?? null,
		choices: await savedModelChoices(savedId ?? undefined, lookup),
		savedEffort: savedEffort ?? null
	};
}

/**
 * The caller's effort, else the budget's. `budgetPatch` gives none for a model that offers no effort levels and for one
 * whose levels are unknown; the saved effort then goes through `resolveEffort`, which the app's pickers use, so both
 * get none. Without this the saved effort would reach a model with no levels: `supportedEffort` in `models.ts`
 * returns the requested effort unchanged when the model lists no levels.
 */
function effortOf(
	pick: RunPick,
	asked: ReasoningEffort | null,
	fromBudget: ReasoningEffort | null
): ReasoningEffort | null {
	const decided = asked ?? fromBudget;

	if (decided) return decided;

	return resolveEffort(pick.choices, pick.savedEffort);
}
