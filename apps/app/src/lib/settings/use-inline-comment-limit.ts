'use client';

import { DEFAULT_AUTO_REVIEW_SETTINGS, MAX_INLINE_COMMENTS } from '@recoder/shared';

import { useAutoReview } from './auto-review-store';
import { parseLimit } from './limits';
import { useNumberField, type LimitFieldView } from './use-number-field';

/**
 * How many findings one review posts as inline comments, worst first; the
 * rest are listed in its summary. A whole number from 0 to
 * `MAX_INLINE_COMMENTS`. Typing saves when the field loses focus or on Enter,
 * Escape puts the saved value back, stepping saves at once, and a refused
 * value shows its reason under the field until it is edited.
 */
export function useInlineCommentLimit(): LimitFieldView {
	const saved = useAutoReview(
		(state) => state.payload?.settings.maxInlineComments ?? DEFAULT_AUTO_REVIEW_SETTINGS.maxInlineComments
	);

	return useNumberField({
		value: saved,
		min: 0,
		max: MAX_INLINE_COMMENTS,
		step: 1,
		shiftStep: 10,
		current: () =>
			useAutoReview.getState().payload?.settings.maxInlineComments ?? DEFAULT_AUTO_REVIEW_SETTINGS.maxInlineComments,
		save: (value) => useAutoReview.getState().save({ maxInlineComments: value }),
		parse: (text) => parseLimit(text, MAX_INLINE_COMMENTS, 0)
	});
}
