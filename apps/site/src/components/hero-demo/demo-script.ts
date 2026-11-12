import type { ApiClient } from '@/lib/api/client';
import type { PullTab } from '@/lib/pull/types';
import { createSampleApi } from '@/lib/sample/sample-api';
import { SAMPLE_REVIEW } from '@/lib/sample/sample-review';

import type { Beat } from './timeline';

/** The pull request the run opens: the sample's reviewed one. */
export const DEMO_PULL = { repoId: SAMPLE_REVIEW.repoId, number: SAMPLE_REVIEW.prNumber ?? 0 };

/** The bug the run dismisses, and the one it posts on the pull request. */
const DISMISSED_BUG = 'sample-f3';
const POSTED_BUG = 'sample-f1';

/** What the window shows at one moment of the run. */
export interface DemoView {
	/** False while the loop fades the window to its empty frame. */
	shown: boolean;
	/** The pull request list, or the pull request's page on a tab. */
	screen: 'list' | PullTab;
	/** Counts the loops, so the app mounts again on each one's own sample. */
	loop: number;
	/** The loop's sample: every loop starts on an untouched one, and nothing leaves memory. */
	api: ApiClient;
}

/** The scripted run and the frame reduced motion shows instead. */
interface Demo {
	beats: Beat[];
	length: number;
	/** Shows the first frame of a new loop: the pull request list of a fresh sample, still covered. */
	reset: () => void;
	/** The still frame: the pull request's bugs. */
	settle: () => void;
}

/**
 * The hero demo's script: apps/app's own screens on its sample, on a
 * timeline of about 17 seconds. It opens the reviewed pull request from the
 * list, reads its changes, dismisses one bug and posts another, and ends on
 * the summary. The two decisions go through the sample's client, the way the
 * buttons send them, so the page changes as it does for a person. `show`
 * gets each new frame.
 */
export function createDemo(show: (view: DemoView) => void): Demo {
	let view: DemoView = { shown: false, screen: 'list', loop: 0, api: createSampleApi() };

	function change(patch: Partial<DemoView>): void {
		view = { ...view, ...patch };
		show(view);
	}

	function reset(): void {
		change({ shown: false, screen: 'list', loop: view.loop + 1, api: createSampleApi() });
	}

	const beats: Beat[] = [];
	let at = 0;

	/** Adds a beat `gap` ms after the one before it. */
	function after(gap: number, run: () => void): void {
		at += gap;
		beats.push({ at, run });
	}

	after(0, () => change({ shown: true }));
	after(2600, () => change({ screen: 'changes' }));
	after(3400, () => change({ screen: 'bugs' }));

	after(2600, () => {
		view.api
			.decide(SAMPLE_REVIEW.id, DISMISSED_BUG, { state: 'dismissed', reason: 'not-worth-fixing' })
			.catch(reportError);
	});

	after(2200, () => {
		view.api.postFinding(SAMPLE_REVIEW.id, POSTED_BUG).catch(reportError);
	});

	after(2600, () => change({ screen: 'summary' }));
	after(3200, () => change({ shown: false }));
	after(320, reset);

	return {
		beats,
		length: at + 360,
		reset,
		settle: () => change({ shown: true, screen: 'bugs' })
	};
}
