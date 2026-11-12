import { cachedReview } from '../review/review-cache';
import { readReview } from '../review/review-read';
import { warmReview } from '../review/review-warm';
import { useShell } from '../shell/shell-store';
import { entryHref, type QueueEntry } from './queue';
import { queueRefreshing, useQueue } from './queue-store';

/** How long the pointer rests on a row, or the selection on one, before its review is read ahead. */
const INTENT_MS = 120;

/** The row a read-ahead is planned for, and the timer that starts it. */
let planned: { key: string; timer: ReturnType<typeof setTimeout> } | null = null;

/** The row whose review to read next, once the read running now ends; the latest wish replaces an earlier one. */
let wanted: string | null = null;

/** True while a read-ahead started here runs. */
let reading = false;

/**
 * The row with `key`, when reading its review ahead is worth it: the live
 * queue is loaded and online, no refresh is in flight, and the row has a
 * finished review. A running review is never read ahead, since its page
 * follows the live stream; nor a draft, whose page is a conversation.
 */
function warmable(key: string): QueueEntry | null {
	const { sample, status, error, entries } = useQueue.getState();
	const entry = entries.find((row) => row.key === key);

	if (sample || status !== 'ready' || error !== null || queueRefreshing()) return null;
	if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
	if (!entry?.review || entry.state === 'reviewing' || entry.state === 'unreviewed') return null;

	return entry;
}

/** Reads the wanted rows' reviews one at a time, checking each again as it comes up. */
async function readWanted(): Promise<void> {
	reading = true;

	while (wanted !== null) {
		const entry = warmable(wanted);

		wanted = null;

		if (entry?.review) await warmReview(entry.review.id, entry.pull);
	}

	reading = false;
}

/**
 * Prefetches the row's review page, so the router has it when the row opens
 * and paints the review in one swap (`navigate`). The page's payload holds
 * no data, so a running review or a draft gets one too.
 */
function prefetchRow(entry: QueueEntry): void {
	const href = entryHref(entry, useQueue.getState().sample);

	if (href) useShell.getState().prefetch(href);
}

function clearPlan(): void {
	if (planned) clearTimeout(planned.timer);

	planned = null;
}

/**
 * Reads a row's review ahead, and prefetches its page, once the pointer or
 * the selection has rested on it for {@link INTENT_MS}, so opening it paints
 * from memory at once. A plan for another row is dropped.
 */
export function warmSoon(entry: QueueEntry): void {
	clearPlan();

	planned = {
		key: entry.key,
		timer: setTimeout(() => {
			planned = null;
			wanted = entry.key;
			prefetchRow(entry);

			if (!reading) void readWanted();
		}, INTENT_MS)
	};
}

/**
 * Drops the read-ahead planned for row `key`, when the pointer leaves it
 * first. Without a key (the queue page is leaving) it drops any plan, and
 * the row waiting its turn. A read already running finishes.
 */
export function cancelWarm(key?: string): void {
	if (key === undefined) wanted = null;
	if (key === undefined || planned?.key === key) clearPlan();
}

/**
 * Opens a row's review at `href`. The row becomes the selected one first, so
 * coming back to the queue puts focus and the mark on it, however it was
 * opened. A review not kept yet is read with the row's pull request beside
 * it, joining a read ahead still running, so the page's header paints whole;
 * the queue stays on screen while that read runs and the router gets the
 * page, and past a moment the review's skeleton takes its place
 * (`navigate`). Any read-ahead still planned is dropped.
 */
export function openRow(entry: QueueEntry, href: string): void {
	const id = entry.review?.id;

	useQueue.getState().select(entry.key);
	cancelWarm();

	if (id && !useQueue.getState().sample && !cachedReview(id)) void readReview(id, entry.pull).catch(() => undefined);

	useShell.getState().navigate(href);
}
