import {
	DEFAULT_SUBAGENT_CAP,
	DEFAULT_TOKEN_BUDGET,
	budgetApplies,
	budgetPatch,
	resolveEffort,
	type BudgetModels,
	type ModelSettings,
	type ModelSettingsPatch,
	type SubagentCap,
	type TokenBudget
} from '@recoder/shared';
import { modelSettingsUi, type ModelChoice } from './model-settings.svelte';

type Limits = ModelSettings['limits'];

const sameChoice = (a: ModelChoice | null | undefined, b: ModelChoice | null | undefined) =>
	(a?.modelId ?? null) === (b?.modelId ?? null) && (a?.effort ?? null) === (b?.effort ?? null);

/** The pick on `effort`, or on its model's default when the budget leaves the effort unset. */
function withEffort(
	choice: ModelChoice | null,
	effort: ModelChoice['effort'],
	model: BudgetModels['orchestrator']
): ModelChoice | null {
	return choice ? { ...choice, effort: effort ?? resolveEffort(model, null) } : null;
}

/**
 * Settings edits held until Save. Seeded from the saved config each time the
 * modal opens; Cancel simply drops it.
 */
class SettingsDraft {
	orchestrator = $state<ModelChoice | null>(null);
	/** Null follows the Review model. */
	specialist = $state<ModelChoice | null>(null);
	limits = $state<Limits>({ maxFiles: 0, maxDiffChars: 0, maxFileChars: 0 });
	/** How many subagents one review may run. */
	subagentCap = $state<SubagentCap>(DEFAULT_SUBAGENT_CAP);
	/** The token budget last picked; its review limits apply even while the cap or an effort has been changed by hand. */
	tokenBudget = $state<TokenBudget>(DEFAULT_TOKEN_BUDGET);
	/** Whether reviews report low-severity findings. */
	reportLowSeverity = $state(true);
	seeded = $state(false);
	private initial: {
		orchestrator: ModelChoice | null;
		specialist: ModelChoice | null;
		limits: Limits;
		subagentCap: SubagentCap;
		tokenBudget: TokenBudget;
		reportLowSeverity: boolean;
	} | null = null;

	seed(config: ModelSettings): void {
		this.orchestrator = modelSettingsUi.orchestrator;
		this.specialist = config.specialistModelId ? modelSettingsUi.specialist : null;
		this.limits = { ...config.limits };
		this.subagentCap = config.subagentCap ?? DEFAULT_SUBAGENT_CAP;
		this.tokenBudget = config.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
		this.reportLowSeverity = config.reportLowSeverity ?? true;

		this.initial = {
			orchestrator: this.orchestrator,
			specialist: this.specialist,
			limits: { ...this.limits },
			subagentCap: this.subagentCap,
			tokenBudget: this.tokenBudget,
			reportLowSeverity: this.reportLowSeverity
		};

		this.seeded = true;
	}

	/** The two model picks as the token budget sees them; a subagent pick on the Review model follows it. */
	private budgetModels(): BudgetModels {
		const find = (choice: ModelChoice | null) => modelSettingsUi.models.find((item) => item.id === choice?.modelId);

		return { orchestrator: find(this.orchestrator), specialist: this.specialist ? find(this.specialist) : 'follows' };
	}

	/** The token budget the pick shows: the one picked, or null (Custom) once the cap or an effort is changed by hand. */
	get shownBudget(): TokenBudget | null {
		const saved = {
			subagentCap: this.subagentCap,
			orchestratorEffort: this.orchestrator?.effort,
			specialistEffort: this.specialist?.effort
		};

		return budgetApplies(this.tokenBudget, saved, this.budgetModels()) ? this.tokenBudget : null;
	}

	/** Picks a token budget: sets the subagent cap and both efforts it stands for. */
	pickBudget(budget: TokenBudget): void {
		const models = this.budgetModels();
		const set = budgetPatch(budget, models);
		const specialistModel = models.specialist === 'follows' ? undefined : models.specialist;

		this.tokenBudget = budget;
		this.subagentCap = set.subagentCap;
		this.orchestrator = withEffort(this.orchestrator, set.orchestratorEffort, models.orchestrator);
		this.specialist = withEffort(this.specialist, set.specialistEffort, specialistModel);
	}

	reset(): void {
		this.seeded = false;
		this.initial = null;
	}

	/** Only what changed since the modal opened. */
	patch(): ModelSettingsPatch {
		const initial = this.initial;

		if (!initial) return {};

		const patch: ModelSettingsPatch = {};

		if (!sameChoice(this.orchestrator, initial.orchestrator) && this.orchestrator) {
			patch.orchestratorModelId = this.orchestrator.modelId;
			patch.orchestratorEffort = this.orchestrator.effort;
		}

		if (!sameChoice(this.specialist, initial.specialist)) {
			patch.specialistModelId = this.specialist?.modelId ?? null;
			patch.specialistEffort = this.specialist?.effort ?? null;
		}

		if (this.limits.maxFiles !== initial.limits.maxFiles) patch.maxFiles = this.limits.maxFiles;
		if (this.limits.maxDiffChars !== initial.limits.maxDiffChars) patch.maxDiffChars = this.limits.maxDiffChars;
		if (this.limits.maxFileChars !== initial.limits.maxFileChars) patch.maxFileChars = this.limits.maxFileChars;
		if (this.subagentCap !== initial.subagentCap) patch.subagentCap = this.subagentCap;
		if (this.tokenBudget !== initial.tokenBudget) patch.tokenBudget = this.tokenBudget;

		if (this.reportLowSeverity !== initial.reportLowSeverity) patch.reportLowSeverity = this.reportLowSeverity;

		return patch;
	}
}

export const settingsDraft = new SettingsDraft();
