import type { DoctorCheck, DoctorReport } from '../doctor/doctor.js';
import type { InitStep } from './init-step.js';

const STEP = { id: 'machine', label: 'This machine', path: null } as const;

/** The doctor's check that a review model resolves, which `recoder init` reports as a step of its own. */
const REVIEW_MODEL_CHECK = 'review-model';

/**
 * Whether a review can run here, as the last step of `recoder init`: ready, or the first thing to fix. When no
 * review model is chosen the step before this one has said so, and the doctor's check for it is left out here.
 */
export function machineStep(report: DoctorReport, hasReviewModel: boolean): InitStep {
	const problems = report.checks.filter((check) => isProblem(check, hasReviewModel));
	const [first] = problems;

	if (first === undefined) {
		const detail = hasReviewModel ? 'ready to review' : 'ready once a review model is chosen';

		return { ...STEP, state: 'unchanged', detail, fix: null };
	}

	const more = problems.length > 1 ? ` (and ${problems.length - 1} more: run recoder doctor)` : '';

	return { ...STEP, state: 'failed', detail: `${first.detail}${more}`, fix: first.fix };
}

function isProblem(check: DoctorCheck, hasReviewModel: boolean): boolean {
	if (check.ok || !check.required) return false;

	return hasReviewModel || check.id !== REVIEW_MODEL_CHECK;
}
