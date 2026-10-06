import { AsyncLocalStorage } from 'node:async_hooks';
import type { ModelConfig } from '../models';

/** Both picks as a review saw them when it started. */
export interface LockedModels {
	orchestrator: ModelConfig;
	subagent: ModelConfig;
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
