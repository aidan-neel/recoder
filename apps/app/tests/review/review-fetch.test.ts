import { afterEach, beforeAll, beforeEach, expect, jest, setSystemTime, test } from 'bun:test';
import type { PrCheck } from '@recoder/shared';

import { useReview } from '../../src/lib/review/review-store';
import { flush } from '../fixtures';
import {
	diffDone,
	diffReads,
	emit,
	held,
	json,
	leave,
	loadGrammars,
	open,
	serve,
	server,
	unserve
} from './review-server';

/** How long the store waits between reads of a diff the server has not made yet. */
const POLL_MS = 4000;

beforeAll(loadGrammars);
beforeEach(serve);

afterEach(() => {
	unserve();
	jest.useRealTimers();
});

test('diff reads never overlap, poll in one chain, and stop when the page leaves', async () => {
	leave();
	server.diffs = [];
	jest.useFakeTimers();
	await open();

	const before = diffReads();

	diffDone();
	diffDone();

	expect(diffReads()).toBe(before + 1);

	await flush();

	expect(diffReads()).toBe(before + 2);

	jest.advanceTimersByTime(POLL_MS + 1);
	await flush();

	expect(diffReads()).toBe(before + 3);

	leave();
	jest.advanceTimersByTime(60000);
	await flush();

	expect(diffReads()).toBe(before + 3);
	expect(useReview.getState().id).toBe('');
});

test('a diff read that answers after the review is found deleted schedules no more reads', async () => {
	leave();
	server.diffs = [];
	jest.useFakeTimers();
	await open();

	const hold = held();

	server.heldDiff = hold.wait;
	jest.advanceTimersByTime(POLL_MS + 1);
	await flush();

	server.deleted = true;
	emit({ type: 'heartbeat', status: 'passed' });
	await flush();

	expect(useReview.getState().status).toBe('missing');

	hold.release();
	await flush();

	const before = diffReads();

	jest.advanceTimersByTime(20000);
	await flush();

	expect(diffReads()).toBe(before);
});

test('a diff read that overlaps another call keeps the draft’s place in its poll count', async () => {
	leave();
	server.review = { ...server.review, status: 'draft' };
	server.diffs = [];
	jest.useFakeTimers();
	await open();

	let hold = held();
	let polls = 0;

	server.answers = (path) => (path.endsWith('/files') ? hold.wait.then(() => json([])) : null);

	for (; polls < 12; polls++) {
		const reads = diffReads();

		jest.advanceTimersByTime(POLL_MS + 1);
		await flush();

		if (diffReads() === reads) break;

		diffDone();
		hold.release();
		await flush();
		hold = held();
	}

	expect(polls).toBeLessThanOrEqual(6);
});

/** Answers the checks with `answer` while it is set; the rest of the server answers as before. */
function checksAnswer(answer: () => Response): void {
	server.answers = (path) => (path.endsWith('/checks') ? Promise.resolve(answer()) : null);
}

test('checks a later read fails to refresh stay, marked with when they were read, until a read answers', async () => {
	const check: PrCheck = { id: '1', name: 'build', state: 'passed', url: null };

	checksAnswer(() => json({ ref: server.review.headSha, checks: [check] }));
	await useReview.getState().retryChecks();

	const readAt = Date.now();

	checksAnswer(() => json({ error: 'The forge is down.' }, 503));

	await useReview
		.getState()
		.retryChecks()
		.catch(() => {});

	const { checks, checksStale, checksError } = useReview.getState();

	expect(checks).toEqual([check]);
	expect(checksError).toBeNull();
	expect(checksStale?.since).toBeLessThanOrEqual(readAt);
	expect(checksStale?.since).toBeGreaterThan(readAt - 1000);

	checksAnswer(() => json({ ref: server.review.headSha, checks: [check] }));
	await useReview.getState().retryChecks();

	expect(useReview.getState().checksStale).toBeNull();
});

test('a rejected token for the checks names the repository on screen while the list of names has not answered', async () => {
	useReview.setState({ repoName: 'acme/api' });
	checksAnswer(() => json({ error: 'Bad credentials' }, 401));

	await useReview
		.getState()
		.retryChecks()
		.catch(() => {});

	expect(useReview.getState().checksError?.text).toBe('GitHub rejected the token for acme/api.');
});

test('a rejected token’s lines name the repository once the list of names answers after them', async () => {
	const names = held();

	leave();
	setSystemTime(new Date(Date.now() + 10 * 60_000));

	server.answers = (path) => {
		if (path === '/api/repos') return names.wait.then(() => json([{ id: server.review.repoId, name: 'acme/api' }]));
		if (path.endsWith('/checks') || path.includes('/pulls/'))
			return Promise.resolve(json({ error: 'Bad credentials' }, 401));

		return null;
	};

	try {
		await open();

		expect(useReview.getState().pullError?.text).toBe('GitHub rejected the token.');
		expect(useReview.getState().checksError?.text).toBe('GitHub rejected the token.');

		names.release();
		await flush();

		expect(useReview.getState().pullError?.text).toBe('GitHub rejected the token for acme/api.');
		expect(useReview.getState().checksError?.text).toBe('GitHub rejected the token for acme/api.');
	} finally {
		setSystemTime();
	}
});

test('a checks read that fails after a newer read answered leaves the newer checks unmarked', async () => {
	const check: PrCheck = { id: '1', name: 'build', state: 'passed', url: null };
	const first = held();
	let reads = 0;

	server.answers = (path) => {
		if (!path.endsWith('/checks')) return null;

		reads += 1;

		if (reads === 1) return first.wait.then(() => json({ error: 'The forge is down.' }, 503));

		return Promise.resolve(json({ ref: server.review.headSha, checks: [check] }));
	};

	const older = useReview.getState().retryChecks();

	await new Promise((resolve) => setTimeout(resolve, 0));
	await useReview.getState().retryChecks();
	first.release();
	await older;

	expect(useReview.getState().checks).toEqual([check]);
	expect(useReview.getState().checksStale).toBeNull();
});
