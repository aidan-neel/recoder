import { rm } from 'node:fs/promises';
import type { RunId } from './run-id.js';
import { readTextIfPresent, runFiles, writeFileAtomically } from './run-files.js';

/**
 * A stop request outlives the signal that announces it. `recoder cancel` stores it before it reads which process holds
 * the run, and the background process reads it after it has recorded itself as that process. So a cancel that read
 * the launcher's id, and whose signal the launcher never passed on (it was exiting, or had exited and was not yet
 * reaped), stored its request before the takeover, and the background process finds it.
 */
export async function requestStop(runId: RunId): Promise<void> {
	await writeFileAtomically(runFiles(runId).stopRequest, `${new Date().toISOString()}\n`);
}

/** Takes back a request whose stop could not be sent, so it does not act later than the caller was told. */
export async function withdrawStop(runId: RunId): Promise<void> {
	await rm(runFiles(runId).stopRequest, { force: true });
}

export async function isStopRequested(runId: RunId): Promise<boolean> {
	return (await readTextIfPresent(runFiles(runId).stopRequest)) !== null;
}
