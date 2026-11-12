import type { ReviewListItem } from '@recoder/shared';
import { create } from 'zustand';

import { reviewsApi } from '../api/reviews';

/** A list younger than this is not read again when the palette opens. */
const FRESH_MS = 60_000;

/**
 * `idle`: never read. `loading`: the first read is out. `ready`: a list is
 * here (a later refresh that fails keeps it). `failed`: the first read failed.
 */
type IndexStatus = 'idle' | 'loading' | 'ready' | 'failed';

interface ReviewIndex {
	/** Every review the server keeps, cut to what a list needs; null until the first read lands. */
	reviews: ReviewListItem[] | null;
	status: IndexStatus;
	/** When the list was last read, in ms since the epoch. */
	loadedAt: number;
}

/**
 * Every review the server keeps, for the palette's Reviews group. It lives in
 * memory for the whole visit, so the palette paints the last list at once
 * and reads it again in the background only once it is a minute old.
 */
export const useReviewIndex = create<ReviewIndex>(() => ({ reviews: null, status: 'idle', loadedAt: 0 }));

/** The read in flight, shared by every caller until it settles. */
let reading: Promise<void> | null = null;

/**
 * Reads the list now, unless a read is already out. A failure keeps the last
 * list. A read after a failed first one stays `failed` until it lands, so the
 * notice and its Try again hold their place while it runs.
 */
function read(): Promise<void> {
	if (reading) return reading;

	const { reviews, status } = useReviewIndex.getState();

	if (!reviews && status !== 'failed') useReviewIndex.setState({ status: 'loading' });

	reading = reviewsApi
		.reviewList()
		.then(
			(list) => useReviewIndex.setState({ reviews: list, status: 'ready', loadedAt: Date.now() }),
			() => useReviewIndex.setState((state) => ({ status: state.reviews ? 'ready' : 'failed' }))
		)
		.finally(() => {
			reading = null;
		});

	return reading;
}

/** Reads the list when it is missing or a minute old; a fresh list stays as it is. `force` reads it regardless (Try again). */
export function refreshReviewIndex(force = false): Promise<void> {
	const { reviews, loadedAt } = useReviewIndex.getState();

	if (!force && reviews && Date.now() - loadedAt < FRESH_MS) return Promise.resolve();

	return read();
}
