import type { DoctorCheck } from './doctor.js';

/** A required check that passed. */
export function passedCheck(id: string, detail: string): DoctorCheck {
	return { id, ok: true, required: true, detail, fix: null };
}

/** A required check that failed, with the one step that fixes it. */
export function failedCheck(id: string, detail: string, fix: string): DoctorCheck {
	return { id, ok: false, required: true, detail, fix };
}
