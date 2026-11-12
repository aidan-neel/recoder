'use client';

import { useSettings } from '../settings/settings-store';
import { reviewModelName } from './step-text';

/** Everything the model step shows. */
export interface ReviewModelView {
	/** The model reviews run on, by name; null when none resolves. */
	name: string | null;
}

/**
 * First run, step two: the model that runs the reviewers, picked right here
 * with the same picker Settings uses.
 */
export function useReviewModel(): ReviewModelView {
	const models = useSettings((state) => state.models);

	return { name: reviewModelName(models) };
}
