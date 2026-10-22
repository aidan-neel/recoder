import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import type { FileDiff, ProgressMessage, Review } from '@recoder/shared';

import { stateOf } from '../../src/lib/review/decisions';
import { surfaceOf, useReview } from '../../src/lib/review/review-store';
import { SAMPLE_DIFFS } from '../../src/lib/sample/sample-diff';
import { SAMPLE_REVIEW } from '../../src/lib/sample/sample-review';
import { useShell } from '../../src/lib/shell/shell-store';
import { memoryStorage } from '../fixtures';
import { FakeEventSource, sources } from './fake-event-source';

/** The review the fake server returns; each test changes it. */
let served: Review;
let stop: () => void = () => {};

/** The diff the fake server returns; empty while the server has not computed it. */
let diffs: FileDiff[] = SAMPLE_DIFFS;

/** Set once the review is deleted on the server: reading it answers 404. */
let deleted = false;

/** While set, a diff read waits for this promise before it answers. */
let heldDiff: Promise<void> | null = null;

/** Every path the store asked the server for, in order. */
const fetched: string[] = [];

/** A stream that opens at once, as a healthy server's does. */
class OpeningEventSource extends FakeEventSource {
	constructor() {
		super();
		queueMicrotask(() => this.accept());
	}
}

/** The review server's answer to one GET. */
function answer(path: string): Response {
	const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

	fetched.push(path);

	if (path === `/api/reviews/${served.id}`) return deleted ? json({ error: 'review not found' }, 404) : json(served);
	if (path.endsWith('/files')) return json(diffs);
	if (path.endsWith('/checks')) return json({ ref: served.headSha, checks: [] });

	return json([]);
}

/** Sends one event down the live stream. */
function emit(message: ProgressMessage): void {
	sources.at(-1)?.onmessage?.({ data: JSON.stringify(message) });
}

/** Lets every pending fetch and state update settle; it waits on promises only, so it works under fake timers. */
async function settle(): Promise<void> {
	for (let turn = 0; turn < 50; turn++) await Promise.resolve();
}

/** How many times the store read the diff. */
function diffReads(): number {
	return fetched.filter((path) => path.endsWith('/files')).length;
}

/** Tells the store the server finished computing the diff. */
function diffDone(): void {
	emit({ type: 'task', data: { task: { id: 'diff', status: 'done' } } } as ProgressMessage);
}

beforeEach(async () => {
	served = { ...SAMPLE_REVIEW, id: 'rv-1', status: 'running', summary: null };
	diffs = SAMPLE_DIFFS;
	deleted = false;
	fetched.length = 0;

	heldDiff = null;

	Object.assign(globalThis, {
		EventSource: OpeningEventSource,
		fetch: (input: string | URL) => {
			const path = new URL(String(input)).pathname;

			return heldDiff && path.endsWith('/files') ? heldDiff.then(() => answer(path)) : Promise.resolve(answer(path));
		},
		localStorage: memoryStorage(),
		document: { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} }
	});

	stop = useReview.getState().load('rv-1');
	await settle();
});

afterEach(() => {
	stop();
	jest.useRealTimers();
	sources.length = 0;
	Reflect.deleteProperty(globalThis, 'localStorage');
	Reflect.deleteProperty(globalThis, 'document');
	Reflect.deleteProperty(globalThis, 'window');
});

describe('review store', () => {
	test('a rerun that drops the selected decision falls back to the overview', () => {
		const decision = surfaceOf(useReview.getState())?.decisions[0];

		useReview.getState().select({ kind: 'decision', id: decision?.id ?? '' });
		emit({ type: 'review', review: { ...served, findings: [], questions: undefined } });

		expect(useReview.getState().selection).toEqual({ kind: 'overview' });
	});

	test('a heartbeat that reports a new status reads the review again', async () => {
		served = { ...served, status: 'passed', summary: 'Done.' };
		emit({ type: 'heartbeat', status: 'passed' });
		await settle();

		expect(useReview.getState().review?.status).toBe('passed');
	});

	test('the bar’s undo reopens its own decision, and undo still restores the last change', () => {
		const [first, second] = surfaceOf(useReview.getState())?.decisions ?? [];

		useReview.getState().decide(first.id, 'accepted');
		useReview.getState().decide(second.id, 'sent');
		useReview.getState().reopen(first.id);

		expect(stateOf(useReview.getState().records, first.id)).toBe('open');
		expect(stateOf(useReview.getState().records, second.id)).toBe('sent');

		useReview.getState().undo();

		expect(stateOf(useReview.getState().records, first.id)).toBe('accepted');
	});

	test('a link to a file opens it once the diff arrives', async () => {
		const path = SAMPLE_DIFFS[0].path;

		stop();
		diffs = [];
		stop = useReview.getState().load('rv-1', path);
		await settle();

		expect(useReview.getState().selection).toEqual({ kind: 'overview' });

		diffs = SAMPLE_DIFFS;
		diffDone();
		await settle();

		expect(useReview.getState().selection).toEqual({ kind: 'file', path });
	});

	test('a review deleted on the server stops following, reads as missing and closes its tab', async () => {
		deleted = true;
		emit({ type: 'heartbeat', status: 'passed' });
		await settle();

		expect(useReview.getState().status).toBe('missing');
		expect(sources.at(-1)?.readyState).toBe(FakeEventSource.CLOSED);
		expect(useShell.getState().tabs.some((tab) => tab.id === 'rv-1')).toBe(false);
	});

	test('a tab keeps its repository and title while the page has not looked them up', async () => {
		stop();
		useShell.getState().openTab({ id: 'rv-1', repo: 'acme/api', pr: 214, title: 'Rate limits', open: 0, high: false });
		served = { ...served, prTitle: null };
		stop = useReview.getState().load('rv-1');
		await settle();

		expect(useShell.getState().tabs.find((tab) => tab.id === 'rv-1')).toMatchObject({
			repo: 'acme/api',
			title: 'Rate limits'
		});
	});

	test('diff reads never overlap, poll in one chain, and stop when the page leaves', async () => {
		stop();
		diffs = [];
		jest.useFakeTimers();
		stop = useReview.getState().load('rv-1');
		await settle();

		const before = diffReads();

		diffDone();
		diffDone();

		expect(diffReads()).toBe(before + 1);

		await settle();

		expect(diffReads()).toBe(before + 2);

		jest.advanceTimersByTime(4001);
		await settle();

		expect(diffReads()).toBe(before + 3);

		stop();
		jest.advanceTimersByTime(60000);
		await settle();

		expect(diffReads()).toBe(before + 3);
		expect(useReview.getState().id).toBe('');
	});

	test('a diff read that answers after the review is found deleted schedules no more reads', async () => {
		stop();
		diffs = [];
		jest.useFakeTimers();
		stop = useReview.getState().load('rv-1');
		await settle();

		let release = () => {};

		heldDiff = new Promise((resolve) => (release = resolve));
		jest.advanceTimersByTime(4001);
		await settle();

		deleted = true;
		emit({ type: 'heartbeat', status: 'passed' });
		await settle();

		expect(useReview.getState().status).toBe('missing');

		release();
		await settle();

		const before = diffReads();

		jest.advanceTimersByTime(20000);
		await settle();

		expect(diffReads()).toBe(before);
	});

	test('a decision another tab saves shows here, and this tab’s next decision keeps it', async () => {
		const [first, second] = surfaceOf(useReview.getState())?.decisions ?? [];
		const otherTab = new EventTarget();
		const key = `recoder.decisions.v1.rv-1@${served.headSha}`;

		stop();
		Object.assign(globalThis, { window: otherTab });
		stop = useReview.getState().load('rv-1');
		await settle();

		localStorage.setItem(key, JSON.stringify({ [first.id]: { state: 'accepted', note: '', at: 1 } }));
		otherTab.dispatchEvent(Object.assign(new Event('storage'), { key }));

		expect(stateOf(useReview.getState().records, first.id)).toBe('accepted');

		useReview.getState().decide(second.id, 'sent');

		expect(Object.keys(JSON.parse(localStorage.getItem(key) ?? '{}')).sort()).toEqual([first.id, second.id].sort());
	});

	test('a review the page cannot read fails the load and never reads as a server that is down', async () => {
		const logged: unknown[] = [];
		const log = console.error;

		console.error = (error: unknown) => logged.push(error);
		stop();
		served = { ...served, findings: [{ id: 'broken', severity: 'high' }] } as unknown as Review;
		stop = useReview.getState().load('rv-1');
		await settle();
		console.error = log;

		expect(useReview.getState().status).toBe('failed');
		expect(logged).toHaveLength(1);
	});
});
