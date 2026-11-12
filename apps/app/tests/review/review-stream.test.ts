import { afterEach, beforeEach, expect, jest, test } from 'bun:test';

import { ReviewStream, SNAPSHOT_MS } from '../../src/lib/review/review-stream';
import { FakeEventSource, sources } from './fake-event-source';

let stream: ReviewStream;
let stale = 0;

/** How many times the stream said its first snapshot did not come in time. */
let missed = 0;

/** Each count of failures in a row the stream passed on. */
let failures: number[] = [];

beforeEach(() => {
	jest.useFakeTimers();
	sources.length = 0;
	stale = 0;
	missed = 0;
	failures = [];
	Object.assign(globalThis, { EventSource: FakeEventSource });

	stream = new ReviewStream('rv-1', {
		onMessage: () => {},
		onConnection: () => {},
		onStale: () => stale++,
		onNoSnapshot: () => missed++,
		onFailures: (count) => failures.push(count)
	});

	stream.open();
});

afterEach(() => {
	stream.close();
	jest.useRealTimers();
});

/** The seconds, over a minute, at which a stream that fails each time it opens was opened. */
function reopenings(fail: (source: FakeEventSource) => void): number[] {
	const opened: number[] = [];

	for (let second = 0; second <= 60; second++) {
		const last = sources.at(-1);

		if (last && last.readyState !== FakeEventSource.CLOSED) {
			opened.push(second);
			fail(last);
		}

		jest.advanceTimersByTime(1000);
	}

	return opened;
}

test('a stream the browser keeps closing is reopened after a wait that doubles each time', () => {
	sources.at(-1)?.giveUp();
	jest.advanceTimersByTime(1999);
	expect(sources).toHaveLength(1);

	jest.advanceTimersByTime(1);
	expect(sources).toHaveLength(2);

	sources.at(-1)?.giveUp();
	jest.advanceTimersByTime(3999);
	expect(sources).toHaveLength(2);

	jest.advanceTimersByTime(1);
	expect(sources).toHaveLength(3);
	expect(stale).toBe(2);
});

test('a stream the server keeps refusing backs off to the ceiling; the silence watchdog never reopens it early', () => {
	expect(reopenings((source) => source.giveUp())).toEqual([0, 2, 6, 14, 30, 60]);
});

test('a stream that cannot reach the server backs off the same way, not on the browser’s own retry', () => {
	expect(reopenings((source) => source.drop())).toEqual([0, 2, 6, 14, 30, 60]);
});

test('failures in a row count up with each one, and start over when the person reconnects', () => {
	sources.at(-1)?.giveUp();
	jest.advanceTimersByTime(2000);
	sources.at(-1)?.giveUp();
	stream.retry();
	sources.at(-1)?.accept();

	expect(failures).toEqual([1, 2, 0]);
});

test('a single drop only reconnects; a second failure in a row reads the review again', () => {
	sources.at(-1)?.accept();
	sources.at(-1)?.drop();
	expect(stale).toBe(0);

	jest.advanceTimersByTime(2000);
	expect(sources).toHaveLength(2);

	sources.at(-1)?.drop();
	expect(stale).toBe(1);
});

test('a stream that keeps failing stays reconnecting through every retry, never connecting again', () => {
	const states: string[] = [];

	const watched = new ReviewStream('rv-2', {
		onMessage: () => {},
		onConnection: (state) => states.push(state),
		onStale: () => {},
		onNoSnapshot: () => {},
		onFailures: () => {}
	});

	watched.open();
	sources.at(-1)?.accept();

	sources.at(-1)?.drop();
	jest.advanceTimersByTime(60000);
	watched.close();

	expect(states).toEqual(['connecting', 'live', 'reconnecting', 'closed']);
});

test('a silent stream reads as reconnecting once a heartbeat is late, and reopens after two', () => {
	const states: string[] = [];
	let reopened = 0;

	const watched = new ReviewStream('rv-2', {
		onMessage: () => {},
		onConnection: (state) => states.push(state),
		onStale: () => reopened++,
		onNoSnapshot: () => {},
		onFailures: () => {}
	});

	watched.open();
	sources.at(-1)?.accept();
	jest.advanceTimersByTime(7000);
	expect(states.at(-1)).toBe('live');

	jest.advanceTimersByTime(1000);
	expect(states.at(-1)).toBe('reconnecting');

	sources.at(-1)?.onmessage?.({ data: JSON.stringify({ type: 'heartbeat' }) });
	expect(states.at(-1)).toBe('live');

	jest.advanceTimersByTime(11000);
	expect(reopened).toBe(1);
	watched.close();
});

test('a stream with no snapshot in time says so once, and a retry reconnects and waits again', () => {
	jest.advanceTimersByTime(SNAPSHOT_MS - 1);
	expect(missed).toBe(0);

	jest.advanceTimersByTime(1);
	expect(missed).toBe(1);

	stream.retry();
	expect(sources).toHaveLength(2);

	jest.advanceTimersByTime(SNAPSHOT_MS - 1);
	expect(missed).toBe(1);

	jest.advanceTimersByTime(1);
	expect(missed).toBe(2);
});

test('a snapshot that arrives in time ends the wait, and later reconnects are not timed', () => {
	sources.at(-1)?.accept();
	sources.at(-1)?.onmessage?.({ data: JSON.stringify({ type: 'snapshot', snapshot: { id: 'rv-1', sequence: 1 } }) });
	jest.advanceTimersByTime(SNAPSHOT_MS);

	stream.retry();
	jest.advanceTimersByTime(SNAPSHOT_MS * 2);

	expect(missed).toBe(0);
});
