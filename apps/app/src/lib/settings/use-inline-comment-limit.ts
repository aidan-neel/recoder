'use client';

import { DEFAULT_AUTO_REVIEW_SETTINGS, MAX_INLINE_COMMENTS } from '@recoder/shared';

import { parseLimit } from './limits';
import { useAutoReview } from './auto-review-store';
import { useNumberField, type LimitFieldView } from './use-number-field';

/**
 * How many findings one review posts as inline comments, worst first; the
 * rest are listed in its summary. A whole number from 0 to
 * `MAX_INLINE_COMMENTS`. It saves when the field loses focus or on Enter;
 * Escape puts the saved value back, and a refused value shows its reason
 * under the field until it is edited.
 */
export function useInlineCommentLimit(): LimitFieldView {
	const saved = useAutoReview(
		(state) => state.payload?.settings.maxInlineComments ?? DEFAULT_AUTO_REVIEW_SETTINGS.maxInlineComments
	);

	return useNumberField({
		value: saved,
		current: () =>
			useAutoReview.getState().payload?.settings.maxInlineComments ?? DEFAULT_AUTO_REVIEW_SETTINGS.maxInlineComments,
		save: (value) => useAutoReview.getState().save({ maxInlineComments: value }),
		parse: (text) => parseLimit(text, MAX_INLINE_COMMENTS, 0)
	});
}
