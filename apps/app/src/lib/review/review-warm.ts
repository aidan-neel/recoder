import type { PullRequest } from '@recoder/shared';

import { useShell } from '../shell/shell-store';
import { cachedReview } from './review-cache';
import { readReview } from './review-read';
import { useReview } from './review-store';

/** Open tabs read ahead at most, the most recently seen first, so the memory copies stay within their limit. */
const WARM_TABS = 3;

/** Reads ahead only once the page has settled and the browser is idle. */
const WARM_DELAY_MS = 1500;

/** The review being read ahead: one read at a time, so moving down a list never fans out into many. */
let warming: string | null = null;

/**
 * Reads a review the person is likely to open next and keeps a copy in
 * memory, so its page paints at once; a pull request the caller already
 * has (the queue's row) goes with it, so the header paints whole too. It
 * does nothing while another read ahead runs, and leaves alone a review
 * already kept, the one the page is loading, and one the server cannot read.
 * Opening the review while the read runs joins it (`readReview`). Resolves
 * once done.
 */
export async function warmReview(id: string, pull: PullRequest | null = null): Promise<void> {
	if (id === 'sample' || warming !== null || useReview.getState().id === id || cachedReview(id)) return;

	warming = id;
	await readReview(id, pull).catch(() => undefined);
	warming = null;
}

/** The open tabs other than `id`, the most recently seen first. */
function otherTabs(id: string): string[] {
	return useShell
		.getState()
		.tabs.filter((tab) => tab.id !== id && tab.id !== 'sample')
		.sort((a, b) => b.seenAt - a.seenAt)
		.slice(0, WARM_TABS)
		.map((tab) => tab.id);
}

/**
 * Reads the other open tabs' reviews ahead while the person reads this one,
 * one after another, so switching tabs never shows a skeleton. Returns the
 * cancel, which stops before the next tab.
 */
export function warmOpenTabs(id: string): () => void {
	let idle: number | null = null;
	let cancelled = false;

	const timer = setTimeout(() => {
		const run = async () => {
			for (const tab of otherTabs(id)) {
				if (cancelled) return;

				await warmReview(tab);
			}
		};

		if (typeof requestIdleCallback === 'function') idle = requestIdleCallback(run, { timeout: WARM_DELAY_MS });
		else void run();
	}, WARM_DELAY_MS);

	return () => {
		cancelled = true;
		clearTimeout(timer);

		if (idle !== null) cancelIdleCallback(idle);
	};
}
