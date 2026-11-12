import { toast } from '@recoder/ui';
import { useSyncExternalStore } from 'react';

import { TimeoutError } from '../api/http';
import { reviewsApi } from '../api/reviews';
import { retryToast, undoToast } from '../shell/notify';
import type { DecisionState } from './surface';

/** The reason the server stores with a dismissal. */
const DISMISS_REASON = 'Not an issue';

/** Where failed writes wait across a reload, per viewer, by `review/finding`. */
const SAVED_KEY = 'recoder.unsaved-dismissals.v1';

/** The most failed writes kept across a reload; the oldest go first. */
const SAVED_LIMIT = 50;

/**
 * How long a write may be on its way before the decision says it is saving,
 * in ms, so a quick save shows nothing. Once Saving shows, it stays as long,
 * so a write that lands just after never makes it blink.
 */
const SAVING_MS = 300;

/**
 * What a dismissal the server may not have means for later reviews. The
 * failure toast and the decision bar both say it, so they never disagree.
 * "May" covers a write the server refused and one that ran out of time,
 * which may have landed.
 */
export const MAY_RAISE = 'Recoder may still raise it.';

/** One finding's write to the server. */
interface Write {
	reviewId: string;
	findingId: string;
	/** True when the write stores the dismissal; false when it takes it away again. */
	dismissed: boolean;
}

/**
 * Where a finding's latest write stands while the server may not have it:
 * on its way past {@link SAVING_MS} (`saving`), failed, or sent again by Try
 * again and not yet answered (`retrying`).
 */
type Phase = 'saving' | 'failed' | 'retrying';

/** A finding whose latest write is slow or failed, so the decision here may not be on the server yet. */
interface Unsettled {
	/** The write, which Try again sends again once it failed. */
	write: Write;
	phase: Phase;
	/** The Try again toast a failure raised; none while saving, once Try again has sent the write, or after a reload. */
	offer?: string | number;
	/** While saving: settles once Saving has shown {@link SAVING_MS}, before which a write that lands leaves it in place. */
	shown?: Promise<void>;
}

/** Each finding's writes still to settle, by `review/finding`; a write waits only on the writes before it for the same finding. */
const chains = new Map<string, Promise<void>>();

/** Dismissals that never reached the server (`review/finding`), so opening one again has nothing to restore there. */
const unsaved = new Set<string>();

/**
 * The findings whose latest write is slow or failed, by `review/finding`. A
 * finding joins as saving when its latest write is still on its way after
 * {@link SAVING_MS}, or as failed when that write fails, and leaves when a
 * write lands (a Saving mark once it has shown as long) or a newer change
 * for the finding is queued. Try again keeps it, as retrying, until the
 * write it sent settles. A failed or retrying one is also kept in storage,
 * so a reload still shows that the server doesn't have it.
 */
const unsettled = new Map<string, Unsettled>();

/** Whoever shows `unsettled`, told each time it changes. */
const listeners = new Set<() => void>();

/** False until the failures a reload left in storage are back in `unsettled`. */
let restored = false;

/** Where a finding's writes are tracked. */
function keyOf(reviewId: string, findingId: string): string {
	return `${reviewId}/${findingId}`;
}

/** The stored write, when it is well formed and stored under its own key; a hand-edited or stale entry is left out. */
function savedWrite(key: string, value: unknown): Write | null {
	if (!value || typeof value !== 'object') return null;

	const { reviewId, findingId, dismissed } = value as Partial<Write>;

	if (typeof reviewId !== 'string' || typeof findingId !== 'string' || typeof dismissed !== 'boolean') return null;

	return keyOf(reviewId, findingId) === key ? { reviewId, findingId, dismissed } : null;
}

/** The failed writes kept in storage, oldest first; none when storage is empty, unreadable or blocked. */
function readSaved(): Map<string, Write> {
	let value: unknown;

	try {
		value = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '{}');
	} catch {
		return new Map();
	}

	const saved = new Map<string, Write>();

	for (const [key, entry] of Object.entries(value && typeof value === 'object' ? value : {})) {
		const write = savedWrite(key, entry);

		if (write) saved.set(key, write);
	}

	return saved;
}

/**
 * Keeps a finding's failed write in storage, newest last, or forgets it. A
 * forget looks in storage even when this page holds no failure for the
 * finding, since another tab may have stored one. Blocked or full storage
 * keeps nothing past this page.
 */
function save(key: string, write: Write | null): void {
	const saved = readSaved();
	const held = saved.delete(key);

	if (!write && !held) return;
	if (write) saved.set(key, write);

	const kept = [...saved].slice(-SAVED_LIMIT);

	try {
		if (kept.length > 0) localStorage.setItem(SAVED_KEY, JSON.stringify(Object.fromEntries(kept)));
		else localStorage.removeItem(SAVED_KEY);
	} catch {}
}

/**
 * Brings back, once per page, the failures a reload left in storage, the
 * first time anything shows them. They raise no toast; the decision shows
 * them. A write sent before then needs none of them: forgetting a failure
 * clears storage too.
 */
function restoreSaved(): void {
	if (restored) return;

	restored = true;

	for (const [key, write] of readSaved()) if (!unsettled.has(key)) unsettled.set(key, { write, phase: 'failed' });
}

/**
 * Sets or clears where the finding's write stands, and tells whoever shows
 * it when that changes anything. Storage keeps only a failure: a slow write
 * may still land, and a reload while it is on its way loses nothing a
 * failure would not.
 */
function setUnsettled(key: string, entry: Unsettled | null): void {
	save(key, entry && entry.phase !== 'saving' ? entry.write : null);

	if (entry) unsettled.set(key, entry);
	else if (!unsettled.delete(key)) return;

	for (const listener of listeners) listener();
}

/**
 * What a failed write leaves, in one sentence beside the toast's Try again.
 * A restore may follow any other decision, so it names none. Neither says why
 * the write failed: a server that can't be reached shows on the review page
 * already, and a server's own words are no use here.
 */
function standing(dismissed: boolean): string {
	return dismissed ? MAY_RAISE : 'Recoder may still treat it as not an issue.';
}

/** Takes away the finding's Try again toast, if one is showing. */
function withdraw(key: string): void {
	const offer = unsettled.get(key)?.offer;

	if (offer !== undefined) toast.dismiss(offer);
}

/**
 * Records the failure and says where the decision stands, with a Try again
 * that sends the same write. The toast's button acts only while that toast is
 * still the failure's offer.
 */
function fail(key: string, write: Write): void {
	const offer = retryToast('Couldn’t save that', standing(write.dismissed), () => {
		if (unsettled.get(key)?.offer === offer) enqueue(write, true);
	});

	setUnsettled(key, { write, phase: 'failed', offer });
}

/**
 * Stores the dismissal on the server. Until it answers, the dismissal counts
 * as never stored. A write that ran out of time may have landed after all, so
 * it counts as stored, and undoing it sends the restore.
 */
async function dismiss(key: string, reviewId: string, findingId: string): Promise<void> {
	unsaved.add(key);

	try {
		await reviewsApi.dismiss(reviewId, findingId, DISMISS_REASON);
		unsaved.delete(key);
	} catch (error) {
		if (error instanceof TimeoutError) unsaved.delete(key);

		throw error;
	}
}

/**
 * Sends one write. A restore of a dismissal the server never stored sends
 * nothing. After a reload that is no longer known, so the restore goes, and
 * the server finds nothing to take away.
 */
async function send(key: string, { reviewId, findingId, dismissed }: Write): Promise<void> {
	if (dismissed) return dismiss(key, reviewId, findingId);
	if (!unsaved.delete(key)) await reviewsApi.restore(reviewId, findingId);
}

/**
 * Marks the finding as saving once `write` has been on its way for
 * {@link SAVING_MS}, while it is still the finding's latest. A write that
 * settled by then is no longer the latest: its chain is gone. The mark then
 * holds as long again (`shown`), whenever the write lands.
 */
function markWhenSlow(key: string, write: Write, latest: () => boolean): void {
	setTimeout(() => {
		if (!latest()) return;

		const shown = new Promise<void>((resolve) => setTimeout(resolve, SAVING_MS));

		setUnsettled(key, { write, phase: 'saving', shown });
	}, SAVING_MS);
}

/**
 * Clears where the finding stands once its latest write landed, after a
 * Saving mark has had its time, and says Saved for a write Try again sent.
 * A newer change meanwhile settles the finding itself, so this then leaves
 * its mark alone.
 */
async function landed(key: string, retried: boolean): Promise<void> {
	const entry = unsettled.get(key);

	await entry?.shown;

	if (unsettled.get(key) !== entry) return;

	setUnsettled(key, null);

	if (retried) undoToast('Saved');
}

/**
 * Sends `write` after the finding's earlier writes. A write still on its way
 * after {@link SAVING_MS} shows as saving. A write that fails while it is
 * still the finding's latest offers to run again, and a `retried` one shows
 * as retrying at once and, when it lands, says so, since the person pressed
 * Try again for it. A write a newer change came after says nothing, since
 * that change's own write settles where the finding stands. The next write
 * never waits on a Saving mark's time.
 */
function enqueue(write: Write, retried = false): void {
	const key = keyOf(write.reviewId, write.findingId);
	const latest = () => chains.get(key) === chain;

	withdraw(key);
	setUnsettled(key, retried ? { write, phase: 'retrying' } : null);

	const chain: Promise<void> = (chains.get(key) ?? Promise.resolve())
		.then(() => send(key, write))
		.then(
			() => {
				if (latest()) void landed(key, retried);
			},
			() => {
				if (latest()) fail(key, write);
			}
		);

	chains.set(key, chain);

	if (!retried) markWhenSlow(key, write, latest);

	void chain.then(() => {
		if (latest()) chains.delete(key);
	});
}

/**
 * Tells the server a finding became "not an issue", or stopped being one, so
 * later reviews of the repo stop raising it. A finding's writes run one at a
 * time, in order, and a failed or timed-out one lets the next go; other
 * findings' writes never wait on it. A failed write keeps the decision here
 * and offers Try again until a newer change for the finding replaces it. Any
 * other change of state sends nothing. A dismissal the server never stored is
 * not restored there, so undoing it reports nothing false.
 */
export function sendDismissal(reviewId: string, findingId: string, was: DecisionState, now: DecisionState): void {
	if (was === now || (was !== 'dismissed' && now !== 'dismissed')) return;

	enqueue({ reviewId, findingId, dismissed: now === 'dismissed' });
}

/** Sends a finding's failed write again, the same one its toast's Try again sends, unless it is already on its way. */
export function retryDismissal(reviewId: string, findingId: string): void {
	const entry = unsettled.get(keyOf(reviewId, findingId));

	if (entry?.phase === 'failed') enqueue(entry.write, true);
}

/** Starts telling `listener` about changes to `unsettled`; returns the stop. */
function subscribe(listener: () => void): () => void {
	listeners.add(listener);

	return () => void listeners.delete(listener);
}

/**
 * Where a finding's latest write stands, or null once it landed, a newer
 * change replaced it, or it never took long enough to show. It counts only
 * while it matches the decision here (`state`), so a failure kept from before
 * a new push, or from another tab, never shows on a decision it doesn't
 * describe.
 */
function phaseOf(reviewId: string | undefined, findingId: string | undefined, state: DecisionState): Phase | null {
	restoreSaved();

	const entry = reviewId && findingId ? unsettled.get(keyOf(reviewId, findingId)) : undefined;

	return entry && entry.write.dismissed === (state === 'dismissed') ? entry.phase : null;
}

/**
 * Where a finding's dismissal or restore stands while the server may not
 * have it: `saving` while a slow write is on its way (and for at least
 * {@link SAVING_MS}), `failed` once it failed, `retrying` while the write Try
 * again sent is on its way, and null once a write lands (see
 * {@link phaseOf}). The server reads the same way: it sends no writes and
 * has no storage, so nothing is pending there, and since no review is drawn
 * on the server, a page that hydrates never meets a state it lacked.
 */
export function useDismissalPhase(
	reviewId: string | undefined,
	findingId: string | undefined,
	state: DecisionState
): Phase | null {
	const read = () => phaseOf(reviewId, findingId, state);

	return useSyncExternalStore(subscribe, read, read);
}

/**
 * Whether a finding's decision is missing from the server: `failed` when its
 * latest write failed, `retrying` while the write Try again sent is on its
 * way, and null otherwise, a write still saving included, since it has not
 * failed (see {@link useDismissalPhase}).
 */
export function useUnsavedDismissal(
	reviewId: string | undefined,
	findingId: string | undefined,
	state: DecisionState
): 'failed' | 'retrying' | null {
	const read = () => {
		const phase = phaseOf(reviewId, findingId, state);

		return phase === 'saving' ? null : phase;
	};

	return useSyncExternalStore(subscribe, read, read);
}
