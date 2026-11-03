/** The Queue tab's id in the top bar; review tabs use their review id. */
export const QUEUE_TAB = 'queue';

/** The sample review's id; its queue is `/sample`. */
const SAMPLE_ID = 'sample';

/** The review id in a `/review/<id>` path, or null on any other page. */
function reviewId(pathname: string): string | null {
	const match = /^\/review\/([^/]+)\/?$/.exec(pathname);

	return match ? decodeURIComponent(match[1]) : null;
}

/** The top-bar tab a path belongs to: the queue, a review's id, or none (a 404). */
export function activeTab(pathname: string): string | null {
	if (pathname === '/' || pathname === '/sample') return QUEUE_TAB;

	return reviewId(pathname);
}

/** True on the sample queue and the sample review, which run without the server. */
export function inSample(pathname: string): boolean {
	return pathname === '/sample' || reviewId(pathname) === SAMPLE_ID;
}

/** True for the sample review, which has nothing on the server to delete or link to. */
export function isSampleReview(id: string): boolean {
	return id === SAMPLE_ID;
}

/** The queue for where the person is: the sample keeps them in the sample. */
export function queueHref(pathname: string): string {
	return inSample(pathname) ? '/sample' : '/';
}

export function reviewHref(id: string): string {
	return `/review/${encodeURIComponent(id)}`;
}

/** What the palette searches on this page, for its placeholder and the scope beside it. */
export function paletteScope(pathname: string): 'review' | 'queue' {
	return reviewId(pathname) ? 'review' : 'queue';
}
