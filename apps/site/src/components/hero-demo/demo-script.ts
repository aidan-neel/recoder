import { DECIDE_KEYS, decideSelected } from '@/components/review/use-review-keys';
import { useQueue } from '@/lib/queue/queue-store';
import { surfaceOf, useReview } from '@/lib/review/review-store';
import { SAMPLE_REVIEW } from '@/lib/sample/sample-review';
import { FLASH_MS, flashKey } from '@/lib/shell/keys';
import { useShell } from '@/lib/shell/shell-store';

import type { Beat } from './timeline';

/** What the window shows beyond the app's stores: the copy button's face, and whether its content shows at all. */
export interface DemoView {
	copied: boolean;
	shown: boolean;
}

/** The calls the run makes, one per decision in rail order: send back the high, accept the medium, send back the question, dismiss the low. */
const CALLS: (keyof typeof DECIDE_KEYS)[] = ['s', 'a', 's', 'x'];

/** What the person adds for the agent on the open question. */
const NOTE = 'Set the TTL in the same command as INCR.';

/** One keystroke of the note every this many ms. */
const TYPE_MS = 30;

/** The open question's id, once the review is loaded. */
function questionId(): string | null {
	return surfaceOf(useReview.getState())?.decisions.find((decision) => decision.kind === 'question')?.id ?? null;
}

/** Writes the note on the open question, as typed so far. */
function typeNote(text: string): void {
	const id = questionId();

	if (id) useReview.getState().setNote(id, text);
}

/** The scripted run, the frame reduced motion shows instead, and the teardown. */
interface Demo {
	beats: Beat[];
	length: number;
	/** Puts the stores at the first frame: the sample queue with #214 selected, no review open. */
	reset: () => void;
	/** The still frame: the overview with the verdict, every decision made and the note written. */
	settle: () => void;
	dispose: () => void;
}

/**
 * The hero demo's script: the app's own stores, driven the way the queue's
 * and the review page's keys drive them, on a timeline of about 23 seconds.
 * Everything lives in memory for one run: the review loads with `persist:
 * false` and the shell store's tabs stop saving until `dispose`, so every
 * loop starts clean and nothing reaches local storage. A keycap shows its
 * press for the app's flash time before the screen it sits on swaps away.
 * `view` changes what the stores do not hold.
 */
export function createDemo(view: (patch: Partial<DemoView>) => void): Demo {
	let unloadQueue = () => {};
	let unloadReview = () => {};

	useShell.getState().setPersistTabs(false);

	function openReview(): void {
		unloadReview = useReview.getState().load(SAMPLE_REVIEW.id, null, { persist: false });
	}

	function closeReview(): void {
		unloadReview();
		unloadReview = () => {};
		useShell.getState().closeTabs([SAMPLE_REVIEW.id]);
	}

	function reset(): void {
		closeReview();
		unloadQueue();
		unloadQueue = useQueue.getState().load(true);

		const sample = useQueue.getState().entries.find((entry) => entry.review?.id === SAMPLE_REVIEW.id);

		useQueue.getState().select(sample?.key ?? null);
	}

	const beats: Beat[] = [];
	let at = 0;

	/** Adds a beat `gap` ms after the one before it. */
	function after(gap: number, run: () => void): void {
		at += gap;
		beats.push({ at, run });
	}

	after(0, () => view({ shown: true }));
	after(2600, () => flashKey('Enter'));
	after(FLASH_MS, openReview);
	after(3000, () => flashKey('Enter'));
	after(FLASH_MS, () => useReview.getState().select(useReview.getState().nextOpen(null)));

	for (const [index, key] of CALLS.entries()) {
		after(index === 0 ? 2800 : 2400, () => {
			decideSelected(DECIDE_KEYS[key]);
			flashKey(key);
		});
	}

	after(2600, () => flashKey('h'));
	after(FLASH_MS, () => useReview.getState().setHandoffOpen(true));

	for (let typed = 1; typed <= NOTE.length; typed++) {
		after(typed === 1 ? 900 : TYPE_MS, () => typeNote(NOTE.slice(0, typed)));
	}

	after(800, () => view({ copied: true }));
	after(1700, () => view({ shown: false }));

	after(320, () => {
		reset();
		view({ copied: false });
	});

	return {
		beats,
		length: at + 360,
		reset,
		settle() {
			reset();
			openReview();

			const decisions = surfaceOf(useReview.getState())?.decisions ?? [];

			for (const [index, key] of CALLS.entries()) {
				if (decisions[index]) useReview.getState().decide(decisions[index].id, DECIDE_KEYS[key]);
			}

			typeNote(NOTE);
		},
		dispose() {
			closeReview();
			unloadQueue();
			useShell.getState().setPersistTabs(true);
		}
	};
}
