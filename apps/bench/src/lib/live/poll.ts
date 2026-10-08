import { invalidate } from '$app/navigation';

/** What the overview and active pages rerun when they poll. */
export const LIVE = 'bench:live';

/** Reruns the loads that depend on `key` every `ms` while the tab is visible; returns the stop function. */
export function poll(key: string, ms: number): () => void {
	const timer = setInterval(() => {
		if (document.visibilityState === 'visible') void invalidate(key);
	}, ms);

	return () => clearInterval(timer);
}
