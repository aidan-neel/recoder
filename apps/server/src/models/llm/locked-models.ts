import { AsyncLocalStorage } from 'node:async_hooks';
import type { ModelPicks } from '@recoder/shared';
import type { ModelConfig } from '../models';

/** All three stage picks as a review saw them when it started. */
export interface LockedModels {
	orchestrator: ModelConfig;
	subagent: ModelConfig;
	verifier: ModelConfig;
}

/**
 * The picks of the review whose work is running, held in memory only since a config carries its API key.
 * Kept apart from `models.ts` so call metrics can read it without importing model routing.
 */
const locked = new AsyncLocalStorage<LockedModels>();

/** Runs `run` with `picks` as the models every call under it resolves to. */
export function runLocked<T>(picks: LockedModels, run: () => T): T {
	return locked.run(picks, run);
}

/** The picks of the pipeline this code runs under, undefined outside one or when its picks did not resolve. */
export function lockedModels(): LockedModels | undefined {
	return locked.getStore();
}

/**
 * The picks of the member whose review or chat is running, which replace the admin's saved Review and Subagent picks
 * wherever a model is resolved under them. Unset for the admin's work, which uses the settings.
 */
const starter = new AsyncLocalStorage<ModelPicks | undefined>();

/** Runs `run` with `picks` as the Review and Subagent picks (undefined: the settings'), so nothing under it skips them. */
export function runWithStarterPicks<T>(picks: ModelPicks | undefined, run: () => T): T {
	return starter.run(picks, run);
}

/** The picks of the member this code runs for, undefined for the admin's work. */
export function starterPicks(): ModelPicks | undefined {
	return starter.getStore();
}
