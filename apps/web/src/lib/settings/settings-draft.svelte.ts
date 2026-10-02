import type { DispatchLevel, ModelSettings, ModelSettingsPatch } from '@recoder/shared';
import { modelSettingsUi, type ModelChoice } from './model-settings.svelte';

type Limits = ModelSettings['limits'];

const sameChoice = (a: ModelChoice | null | undefined, b: ModelChoice | null | undefined) =>
	(a?.modelId ?? null) === (b?.modelId ?? null) && (a?.effort ?? null) === (b?.effort ?? null);

/**
 * Settings edits held until Save. Seeded from the saved config each time the
 * modal opens; Cancel simply drops it.
 */
class SettingsDraft {
	orchestrator = $state<ModelChoice | null>(null);
	/** Null follows the Review model. */
	specialist = $state<ModelChoice | null>(null);
	limits = $state<Limits>({ maxFiles: 0, maxDiffChars: 0, maxFileChars: 0 });
	/** How many specialists a review may dispatch. */
	dispatch = $state<DispatchLevel>('medium');
	seeded = $state(false);
	private initial: {
		orchestrator: ModelChoice | null;
		specialist: ModelChoice | null;
		limits: Limits;
		dispatch: DispatchLevel;
	} | null = null;

	seed(config: ModelSettings): void {
		this.orchestrator = modelSettingsUi.orchestrator;
		this.specialist = config.specialistModelId ? modelSettingsUi.specialist : null;
		this.limits = { ...config.limits };
		this.dispatch = config.specialistDispatch ?? 'medium';

		this.initial = {
			orchestrator: this.orchestrator,
			specialist: this.specialist,
			limits: { ...this.limits },
			dispatch: this.dispatch
		};

		this.seeded = true;
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
		if (this.dispatch !== initial.dispatch) patch.specialistDispatch = this.dispatch;

		return patch;
	}
}

export const settingsDraft = new SettingsDraft();
