import type { AgentProvider, ModelSettings, Repo } from '@recoder/shared';

import type { LoadStatus } from '../connections/connections-store';
import type { useSettings } from '../settings/settings-store';
import type { SetupGate } from './setup-gate';

/** Where the settings load stands (`offline`: the server did not answer). */
type SettingsStatus = ReturnType<typeof useSettings.getState>['status'];

/** First run's three steps, true once done. */
export interface SetupSteps {
	provider: boolean;
	model: boolean;
	repo: boolean;
}

/**
 * What first run still needs. A provider counts as connected when OpenCode
 * has one, or when any agent (Claude Code, Devin) already offers models, or
 * when a model is configured some other way (the RECODER_REVIEW_* variables).
 */
export function setupSteps(models: ModelSettings, providers: AgentProvider[], repos: Repo[]): SetupSteps {
	return {
		provider: providers.some((provider) => provider.connected) || models.models.length > 0 || models.configured,
		model: models.configured,
		repo: repos.length > 0
	};
}

/** How many steps are left, 0 to 3. */
export function stepsLeft(steps: SetupSteps): number {
	return [steps.provider, steps.model, steps.repo].filter((done) => !done).length;
}

interface GateInput {
	settings: SettingsStatus;
	repos: LoadStatus;
	auth: LoadStatus;
	/** Null until the settings and the repositories have loaded. */
	steps: SetupSteps | null;
	/** True while first run is on screen; it lets go a beat after its last step is done. */
	holding: boolean;
	/** True while the settings and repositories load again because the server came back after failing them. */
	recovering: boolean;
}

/**
 * The gate. A server that is down, or that fails the repository list, lets
 * the queue through so it can show its own notice; once the server answers
 * again, the gate checks until the settings and repositories have reloaded.
 * First run waits for the forge check too, so it paints with the right
 * actions in place.
 */
export function gateOf({ settings, repos, auth, steps, holding, recovering }: GateInput): SetupGate {
	if (recovering) return 'checking';
	if (settings === 'offline' || repos === 'offline' || repos === 'error') return 'done';
	if (!steps) return 'checking';
	if (stepsLeft(steps) === 0 && !holding) return 'done';
	if (auth === 'idle' || auth === 'loading') return 'checking';

	return 'needed';
}
