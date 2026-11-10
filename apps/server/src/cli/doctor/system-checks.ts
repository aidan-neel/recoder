import { accessSync, constants, mkdirSync } from 'node:fs';
import { env } from '../../env.js';
import { execUnavailableReason } from '../../sandbox/exec-sandbox.js';
import { serverDataDir } from '../../util/data-dir.js';
import { describeError } from '../exit.js';
import { failedCheck, passedCheck } from './check-result.js';
import type { DoctorCheck } from './doctor.js';

interface WritableDirectory {
	id: string;
	label: string;
	/** The variable that moves the folder, for the fix. */
	variable: string;
	locate(): string;
}

const DIRECTORIES: WritableDirectory[] = [
	{ id: 'data-dir', label: 'Data folder', variable: 'RECODER_DATA_DIR', locate: serverDataDir },
	{ id: 'workdir', label: 'Checkout folder', variable: 'RECODER_WORKDIR', locate: () => env.RECODER_WORKDIR }
];

export function checkGit(): DoctorCheck {
	const path = Bun.which('git');

	if (!path) return failedCheck('git', 'git is not on PATH.', 'Install git and put it on PATH.');

	return passedCheck('git', `git found at ${path}.`);
}

/**
 * Every run records its process with ps when it starts, and `recoder status`, `wait` and `cancel` use it to check that
 * process, so without ps no review can start.
 */
export function checkPs(): DoctorCheck {
	const path = Bun.which('ps');

	if (!path)
		return failedCheck('ps', 'ps is not on PATH, so no review can record its run.', 'Install ps and put it on PATH.');

	return passedCheck('ps', `ps found at ${path}.`);
}

export async function checkWritableDirectories(): Promise<DoctorCheck[]> {
	return DIRECTORIES.map(checkWritable);
}

/** Code can run in a sandbox on Linux with bubblewrap and on macOS; without it reviews are read-only, which is not a failure. */
export async function checkSandbox(): Promise<DoctorCheck> {
	const reason = await execUnavailableReason();

	if (reason) return { id: 'sandbox', ok: false, required: false, detail: reason, fix: null };

	return { id: 'sandbox', ok: true, required: false, detail: 'Reviewers can run code in the sandbox.', fix: null };
}

function checkWritable(directory: WritableDirectory): DoctorCheck {
	try {
		const path = directory.locate();

		mkdirSync(path, { recursive: true });
		accessSync(path, constants.W_OK);

		return passedCheck(directory.id, `${directory.label} ${path} is writable.`);
	} catch (error) {
		return failedCheck(
			directory.id,
			`${directory.label} is not writable: ${describeError(error)}`,
			`Make the folder writable, or set ${directory.variable} to another one.`
		);
	}
}
