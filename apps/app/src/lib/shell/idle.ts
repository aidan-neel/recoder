import { whenIdle } from '@recoder/ui';

/** How long after a page mounts its first content may still be loading. */
const SETTLE_MS = 2000;

/** Then the longest wait for an idle moment. */
const SETTLE_IDLE_MS = 3000;

/**
 * Runs `run` once the page has had time to paint its first content and then
 * gone idle: for work fetched ahead of a click (code, pages), which no first
 * paint should carry. Returns the cancel.
 */
export function whenSettled(run: () => void): () => void {
	let cancelIdle = () => {};

	const timer = setTimeout(() => {
		cancelIdle = whenIdle(run, SETTLE_IDLE_MS);
	}, SETTLE_MS);

	return () => {
		clearTimeout(timer);
		cancelIdle();
	};
}
