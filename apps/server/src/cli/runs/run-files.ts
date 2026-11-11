import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serverDataDir } from '../../util/data-dir.js';
import { describeError, errorCode } from '../exit.js';
import { writeStderrLine } from '../output/streams.js';
import type { RunId } from './run-id.js';

const RUNS_FOLDER = 'cli-runs';

/** A report quotes source code, so a run's folder and files are readable by their owner only. */
const PRIVATE_FOLDER_MODE = 0o700;

export const PRIVATE_FILE_MODE = 0o600;

const TEMPORARY_SUFFIX_BYTES = 4;

/** Where one run keeps what it records. */
export interface RunFiles {
	folder: string;
	/** The run's record, `run.json`. */
	record: string;
	/** The complete, unfiltered report, once the review returns one. */
	report: string;
	/** Every progress event, one JSON object per line. */
	progress: string;
	/** Standard error of a background run. */
	log: string;
	/** Present once `recoder cancel` asked the run to stop; see `stop-request.ts`. */
	stopRequest: string;
}

/** The folder that holds every run's folder. */
export function runsRoot(): string {
	return join(serverDataDir(), RUNS_FOLDER);
}

export function runFiles(runId: RunId): RunFiles {
	const folder = join(runsRoot(), runId);

	return {
		folder,
		record: join(folder, 'run.json'),
		report: join(folder, 'report.json'),
		progress: join(folder, 'progress.ndjson'),
		log: join(folder, 'background.log'),
		stopRequest: join(folder, 'stop-requested')
	};
}

/** Creates the run's folder. It fails when the folder exists, so a run never takes over another's. */
export async function createRunFolder(runId: RunId): Promise<RunFiles> {
	const files = runFiles(runId);

	await mkdir(runsRoot(), { recursive: true, mode: PRIVATE_FOLDER_MODE });
	await mkdir(files.folder, { mode: PRIVATE_FOLDER_MODE });

	return files;
}

export async function removeRunFolder(runId: RunId): Promise<void> {
	await rm(runFiles(runId).folder, { recursive: true, force: true });
}

/** Writes a private file through a temporary file and a rename, so a reader sees the old text or the new, never half. */
export async function writeFileAtomically(path: string, text: string): Promise<void> {
	const temporary = `${path}.${process.pid}.${randomBytes(TEMPORARY_SUFFIX_BYTES).toString('hex')}.tmp`;

	try {
		await writeFile(temporary, text, { mode: PRIVATE_FILE_MODE });
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });

		throw error;
	}
}

/** A file's text; null when it does not exist. */
export async function readTextIfPresent(path: string): Promise<string | null> {
	try {
		return await readFile(path, 'utf8');
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return null;

		throw error;
	}
}

/** JSON read back from a run's files; text that does not parse fails with the error `fail` builds. */
export function parseJson(text: string, fail: (reason: string) => Error): unknown {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw fail(describeError(error));
	}
}

/**
 * Reports that the record of a run could not be kept. Recording is bookkeeping: it must never stop a review or
 * change what the review prints, so the failure is said on standard error and the review goes on.
 */
export function warnRecordFailure(runId: RunId, action: string, error: unknown): void {
	writeStderrLine(`recoder: cannot ${action} for run ${runId}: ${describeError(error)}`);
}
