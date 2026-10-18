import { afterEach, beforeEach, expect, jest, test } from 'bun:test';

import { ReviewStream } from '../../src/lib/review/review-stream';
import { FakeEventSource, sources } from './fake-event-source';

let stream: ReviewStream;
let stale = 0;

beforeEach(() => {
	jest.useFakeTimers();
	sources.length = 0;
	stale = 0;
	Object.assign(globalThis, { EventSource: FakeEventSource });
	stream = new ReviewStream('rv-1', { onMessage: () => {}, onConnection: () => {}, onStale: () => stale++ });
	stream.open();
});

afterEach(() => {
	stream.close();
	jest.useRealTimers();
});

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

test('a watchdog reconnect cancels a pending retry, so the retry never replaces the new stream', () => {
	jest.advanceTimersByTime(19000);
	sources.at(-1)?.giveUp();

	jest.advanceTimersByTime(1000);
	expect(sources).toHaveLength(2);

	jest.advanceTimersByTime(5000);
	expect(sources).toHaveLength(2);
	expect(sources[1].readyState).not.toBe(FakeEventSource.CLOSED);
});

test('a stream that keeps failing stays reconnecting through every retry, never connecting again', () => {
	const states: string[] = [];

	const watched = new ReviewStream('rv-2', {
		onMessage: () => {},
		onConnection: (state) => states.push(state),
		onStale: () => {}
	});

	watched.open();
	sources.at(-1)?.accept();

	const dropped = sources.at(-1);

	if (dropped) dropped.readyState = 0;

	dropped?.onerror?.();
	jest.advanceTimersByTime(60000);
	watched.close();

	expect(states).toEqual(['connecting', 'live', 'reconnecting', 'closed']);
});
