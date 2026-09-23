import type { ModelSettings, ModelSettingsPatch, ReviewRole } from '@recoder/shared';
import { MODEL_ROLES, modelSettingsUi, type ModelChoice } from './model-settings.svelte';

type Limits = ModelSettings['limits'];

const sameChoice = (a: ModelChoice | null | undefined, b: ModelChoice | null | undefined) =>
	(a?.modelId ?? null) === (b?.modelId ?? null) && (a?.effort ?? null) === (b?.effort ?? null);

/**
 * Settings edits held until Save. Seeded from the saved config each time the
 * modal opens; Cancel simply drops it.
 */
class SettingsDraft {
	orchestrator = $state<ModelChoice | null>(null);
	roles = $state<Partial<Record<ReviewRole, ModelChoice | null>>>({});
	baseUrl = $state('');
	/** Typed API key; empty keeps the saved one. */
	apiKey = $state('');
	limits = $state<Limits>({ maxFiles: 0, maxDiffChars: 0, maxFileChars: 0 });
	seeded = $state(false);
	private initial: { orchestrator: ModelChoice | null; roles: Partial<Record<ReviewRole, ModelChoice | null>>; baseUrl: string; limits: Limits } | null = null;

	seed(config: ModelSettings): void {
		this.orchestrator = modelSettingsUi.orchestrator;
		this.roles = Object.fromEntries(MODEL_ROLES.map((role) => [role, modelSettingsUi.roleChoice(role)]));
		this.baseUrl = config.baseUrl ?? '';
		this.apiKey = '';
		this.limits = { ...config.limits };
		this.initial = {
			orchestrator: this.orchestrator,
			roles: { ...this.roles },
			baseUrl: this.baseUrl,
			limits: { ...this.limits }
		};
		this.seeded = true;
	}

	reset(): void {
		this.seeded = false;
		this.initial = null;
		this.apiKey = '';
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
		const roles: Partial<Record<ReviewRole, string>> = {};
		const roleEfforts: ModelSettingsPatch['roleEfforts'] = {};
		for (const role of MODEL_ROLES) {
			const choice = this.roles[role];
			if (!choice || sameChoice(choice, initial.roles[role])) continue;
			roles[role] = choice.modelId;
			if (choice.effort) roleEfforts[role] = choice.effort;
		}
		if (Object.keys(roles).length) patch.roles = roles;
		if (Object.keys(roleEfforts).length) patch.roleEfforts = roleEfforts;
		if (this.baseUrl.trim() !== initial.baseUrl) patch.baseUrl = this.baseUrl.trim();
		if (this.apiKey.trim()) patch.apiKey = this.apiKey.trim();
		if (this.limits.maxFiles !== initial.limits.maxFiles) patch.maxFiles = this.limits.maxFiles;
		if (this.limits.maxDiffChars !== initial.limits.maxDiffChars) patch.maxDiffChars = this.limits.maxDiffChars;
		if (this.limits.maxFileChars !== initial.limits.maxFileChars) patch.maxFileChars = this.limits.maxFileChars;
		return patch;
	}
}

export const settingsDraft = new SettingsDraft();
