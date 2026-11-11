import { bootHeadless } from '../run/boot.js';
import { checkGit, checkPs, checkSandbox, checkWritableDirectories } from './system-checks.js';
import { checkAgentSignIns, checkReviewModel } from './model-checks.js';

/** One prerequisite: whether it is met, what was found, and the one step that fixes it. */
export interface DoctorCheck {
	id: string;
	ok: boolean;
	/** A failed required check stops reviews from running; a failed optional one only limits them. */
	required: boolean;
	detail: string;
	/** One short imperative line; null when the check passed or there is nothing to do. */
	fix: string | null;
}

export interface DoctorReport {
	/** True when every required check passed. */
	ok: boolean;
	checks: DoctorCheck[];
}

/**
 * Checks what a review needs: git, writable folders, a review model and its sign-in, and whether code can run in the
 * sandbox. Makes no model call and starts no server.
 */
export async function runDoctor(): Promise<DoctorReport> {
	bootHeadless();

	const checks = [
		checkGit(),
		checkPs(),
		...(await checkWritableDirectories()),
		await checkReviewModel(),
		...(await checkAgentSignIns()),
		await checkSandbox()
	];

	return { ok: checks.every((check) => check.ok || !check.required), checks };
}
