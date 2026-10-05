/** Distance from the bottom, in px, within which a reader still counts as following. */
const FOLLOW_SLACK = 24;

/**
 * Keeps a scrolling box on its newest content while it grows, until the reader scrolls up.
 * Returns the cleanup.
 */
export function followOutput(viewport: HTMLElement): () => void {
	let pinned = true;

	const follow = () => {
		if (pinned) viewport.scrollTop = viewport.scrollHeight;
	};

	const onScroll = () => {
		pinned = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - FOLLOW_SLACK;
	};

	const observer = new ResizeObserver(follow);

	for (const child of Array.from(viewport.children)) observer.observe(child);
	viewport.addEventListener('scroll', onScroll, { passive: true });
	follow();

	return () => {
		observer.disconnect();
		viewport.removeEventListener('scroll', onScroll);
	};
}
