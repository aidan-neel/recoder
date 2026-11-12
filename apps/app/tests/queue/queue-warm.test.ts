import { afterEach, beforeEach, expect, test } from 'bun:test';
import { reviewListItem } from '@recoder/shared';

import type { QueueEntry } from '../../src/lib/queue/queue';
import { useQueue } from '../../src/lib/queue/queue-store';
import { cancelWarm, openRow, warmSoon } from '../../src/lib/queue/queue-warm';
import { forgetReview } from '../../src/lib/review/review-cache';
import { SAMPLE_REVIEW } from '../../src/lib/sample/sample-review';
import { useShell } from '../../src/lib/shell/shell-store';
import { pull } from './fixtures';

/** Longer than the hover and selection intent delay. */
const PAST_INTENT_MS = 150;

/** Review reads the server has been asked for, by review id, in order. */
let reads: string[];

/** Review ids whose read the server holds until released. */
let held: Map<string, () => void>;

/** A queue row for pull request `number`, whose latest review is `rv-<number>` in `state`. */
function row(number: number, state: QueueEntry['state'] = 'needs-you'): QueueEntry {
	return {
		key: `repo#${number}`,
		repoId: 'repo',
		repo: 'acme/api',
		pull: pull(number),
		review: reviewListItem({ ...SAMPLE_REVIEW, id: `rv-${number}` }),
		state,
		open: 1,
		tone: 'high',
		sent: 0,
		receipts: 0
	};
}

const json = (body: unknown) => new Response(JSON.stringify(body));

/** The review server: a review read waits while the test holds it; the diff and the repositories answer at once. */
async function answer(url: URL): Promise<Response> {
	const review = url.pathname.match(/^\/api\/reviews\/([^/]+)$/)?.[1];

	if (url.pathname === '/api/repos') return json([]);
	if (!review) return json([]);

	reads.push(review);
	await new Promise<void>((resolve) => held.set(review, resolve));

	return json({ ...SAMPLE_REVIEW, id: review });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ROWS = [row(1), row(2), row(3), row(4, 'reviewing')];

beforeEach(() => {
	reads = [];
	held = new Map();
	Object.assign(globalThis, { fetch: (input: string | URL) => answer(new URL(String(input))) });
	useQueue.setState({ sample: false, status: 'ready', error: null, entries: ROWS });
});

afterEach(async () => {
	cancelWarm();

	for (const release of held.values()) release();

	await settle();

	for (const entry of ROWS) forgetReview(entry.review!.id);
});

test('reviews are read ahead one at a time, and only the latest row asked for meanwhile goes next', async () => {
	warmSoon(ROWS[0]);
	await wait(PAST_INTENT_MS);

	warmSoon(ROWS[1]);
	await wait(PAST_INTENT_MS);
	warmSoon(ROWS[2]);
	await wait(PAST_INTENT_MS);

	expect(reads).toEqual(['rv-1']);

	held.get('rv-1')?.();
	await settle();

	expect(reads).toEqual(['rv-1', 'rv-3']);
});

test('a row the pointer rests on has its review page prefetched, so opening it paints in one swap', async () => {
	const prefetched: string[] = [];

	useShell.getState().setNavigate({ push: () => {}, replace: () => {}, prefetch: (href) => prefetched.push(href) });

	warmSoon(ROWS[0]);
	await wait(PAST_INTENT_MS);

	expect(prefetched).toEqual(['/review/rv-1']);
});

test('a row the pointer leaves before the intent delay is not read ahead', async () => {
	warmSoon(ROWS[0]);
	await wait(40);
	cancelWarm(ROWS[0].key);
	await wait(PAST_INTENT_MS);

	expect(reads).toEqual([]);
});

test('a running review is never read ahead, since its page follows the live stream', async () => {
	warmSoon(ROWS[3]);
	await wait(PAST_INTENT_MS);

	expect(reads).toEqual([]);
});

test('nothing is read ahead while the queue shows a failed refresh', async () => {
	useQueue.setState({ error: 'Can’t reach the review server.' });
	warmSoon(ROWS[0]);
	await wait(PAST_INTENT_MS);

	expect(reads).toEqual([]);
});

test('opening a row with the mouse selects it, so Back returns focus and the mark to that row', () => {
	useQueue.setState({ selected: ROWS[0].key });

	useShell.getState().setNavigate({ push: () => {}, replace: () => {}, prefetch: () => {} });

	openRow(ROWS[2], '/review/rv-3');

	expect(useQueue.getState().selected).toBe(ROWS[2].key);
});
