import type { AgentProvider, ModelSettings, Repo, SetupStatus } from '@recoder/shared';

import type { SetupGate } from './setup-gate';

/** First run's three steps, true once done. */
export interface SetupSteps {
	provider: boolean;
	model: boolean;
	repo: boolean;
}

/**
 * Where the server's setup check stands. `failed`: it answered with an
 * error, or not in time. `offline`: it never answered.
 */
export type SetupCheck = 'idle' | 'loading' | 'ready' | 'failed' | 'offline';

/**
 * What first run still needs, from the stores it loads. A provider counts as
 * connected when OpenCode has one, or when any agent (Claude Code, Devin)
 * already offers models, or when a model is configured some other way (the
 * RECODER_REVIEW_* variables).
 */
export function setupSteps(models: ModelSettings, providers: AgentProvider[], repos: Repo[]): SetupSteps {
	return {
		provider: providers.some((provider) => provider.connected) || models.models.length > 0 || models.configured,
		model: models.configured,
		repo: repos.length > 0
	};
}

/** The same steps from the server's small setup status, which the gate reads without loading the model catalog. */
export function stepsOfStatus(status: SetupStatus): SetupSteps {
	return { provider: status.providerConnected, model: status.configured, repo: status.repoCount > 0 };
}

/** How many steps are left, 0 to 3. */
export function stepsLeft(steps: SetupSteps): number {
	return [steps.provider, steps.model, steps.repo].filter((done) => !done).length;
}

/** A stored value that is a whole set of steps, or null for anything else. */
export function parseSteps(text: string | null): SetupSteps | null {
	try {
		const value = JSON.parse(text ?? 'null') as Partial<Record<keyof SetupSteps, unknown>> | null;

		if (!value || typeof value !== 'object') return null;

		const { provider, model, repo } = value;

		if (typeof provider !== 'boolean' || typeof model !== 'boolean' || typeof repo !== 'boolean') return null;

		return { provider, model, repo };
	} catch {
		return null;
	}
}

interface GateInput {
	/** What first run needs now: from the stores it loads, else from the server's status. Null until either is known. */
	steps: SetupSteps | null;
	/** The steps the last visit saw, so a returning person's gate decides at once. */
	saved: SetupSteps | null;
	check: SetupCheck;
	/** True once the bounded wait for the check ran out. */
	waited: boolean;
	/** True while first run is on screen; it lets go a beat after its last step is done. */
	holding: boolean;
	/** True while the check runs again because the server came back after the first one never reached it. */
	recovering: boolean;
}

/**
 * The gate. First run keeps the page while it shows. Known steps decide;
 * before they are known, the steps the last visit saw decide at once, so a
 * returning person never waits on the check (first run, shown on stale steps,
 * ends with its closing beat once the check says all is done). A check that
 * fails, or that has not answered by the end of the wait, lets the queue
 * through too, so the page never hangs on it; the queue then shows its own
 * notice. Once the server comes back after never answering, the gate checks
 * again.
 */
export function gateOf({ steps, saved, check, waited, holding, recovering }: GateInput): SetupGate {
	if (holding) return 'needed';
	if (recovering) return 'checking';
	if (steps) return stepsLeft(steps) === 0 ? 'done' : 'needed';
	if (saved) return stepsLeft(saved) === 0 ? 'done' : 'needed';
	if (check === 'failed' || check === 'offline' || waited) return 'done';

	return 'checking';
}
