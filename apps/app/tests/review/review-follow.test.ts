import { afterEach, beforeAll, beforeEach, expect, jest, test } from 'bun:test';
import { emptyReviewProgress, type ProgressMessage } from '@recoder/shared';

import { progressStatus, useReview } from '../../src/lib/review/review-store';
import { SNAPSHOT_MS } from '../../src/lib/review/review-stream';
import { flush } from '../fixtures';
import { sources } from './fake-event-source';
import { emit, leave, loadGrammars, open, serve, server, unserve } from './review-server';

/** A snapshot of rv-1's progress at `sequence`, as the server sends it. */
function snapshot(sequence: number): ProgressMessage {
	return { type: 'snapshot', snapshot: { ...emptyReviewProgress('rv-1'), sequence } } as ProgressMessage;
}

beforeAll(loadGrammars);
beforeEach(serve);

afterEach(() => {
	unserve();
	jest.useRealTimers();
});

test('a heartbeat that reports a new status reads the review again', async () => {
	server.review = { ...server.review, status: 'passed', summary: 'Done.' };
	emit({ type: 'heartbeat', status: 'passed' });
	await flush();

	expect(useReview.getState().review?.status).toBe('passed');
});

test('the live views read as failed when no snapshot comes in time, and reconnecting waits again', async () => {
	leave();
	jest.useFakeTimers();
	await open();

	expect(progressStatus(useReview.getState())).toBe('waiting');

	jest.advanceTimersByTime(SNAPSHOT_MS);

	expect(progressStatus(useReview.getState())).toBe('failed');

	useReview.getState().reconnect();

	expect(progressStatus(useReview.getState())).toBe('waiting');

	emit(snapshot(1));

	expect(progressStatus(useReview.getState())).toBe('ready');
});

test('the snapshot that opens a new connection replaces progress the server lost in a restart', async () => {
	jest.useFakeTimers();
	emit(snapshot(40));
	emit(snapshot(2));

	expect(useReview.getState().progress?.sequence).toBe(40);

	sources.at(-1)?.giveUp();
	jest.advanceTimersByTime(2000);
	await flush();
	emit(snapshot(3));

	expect(useReview.getState().progress?.sequence).toBe(3);
});

test('a refresh that reaches the server after an outage reconnects the stream at once, not after its retry wait', async () => {
	jest.useFakeTimers();
	server.answers = (path) => (path === '/api/reviews/rv-1' ? Promise.reject(new TypeError('Failed to fetch')) : null);
	sources.at(-1)?.giveUp();
	await flush();

	const opened = sources.length;

	expect(useReview.getState().staleSince).not.toBeNull();

	server.answers = null;
	await useReview.getState().refresh();

	expect(sources).toHaveLength(opened + 1);
	expect(useReview.getState().staleSince).toBeNull();
});
