import { afterEach, beforeAll, beforeEach, expect, setSystemTime, test } from 'bun:test';
import { emptyReviewProgress, type ProgressMessage, type Review } from '@recoder/shared';

import { useReview } from '../../src/lib/review/review-store';
import { SAMPLE_DIFFS } from '../../src/lib/sample/sample-diff';
import { useShell } from '../../src/lib/shell/shell-store';
import { flush } from '../fixtures';
import { FakeEventSource, sources } from './fake-event-source';
import { close, emit, held, json, leave, loadGrammars, open, serve, server, unserve } from './review-server';

/** A fetch that never reached the server, as the browser rejects it. */
function unreachable(): Promise<Response> {
	return Promise.reject(new TypeError('Failed to fetch'));
}

/** Opens the page again a minute later, so the copy it kept is too old to skip the refresh. */
async function openLater(): Promise<void> {
	setSystemTime(new Date(Date.now() + 60_000));
	await open(null, false);
	setSystemTime();
}

beforeAll(loadGrammars);
beforeEach(serve);
afterEach(unserve);

test('a first visit paints once the review and its diff are in, while the pull request and the checks still answer', async () => {
	const forge = held();

	leave();

	server.answers = (path) => {
		if (path.endsWith('/checks')) return forge.wait.then(() => json({ ref: server.review.headSha, checks: [] }));

		return path.includes('/pulls/') ? forge.wait.then(() => json({ pr: null })) : null;
	};

	await open();

	expect(useReview.getState().status).toBe('ready');
	expect(useReview.getState().pullAnswered).toBe(false);
	expect(useReview.getState().checks).toBeNull();

	forge.release();
	await flush();

	expect(useReview.getState().pullAnswered).toBe(true);
});

test('a review deleted on the server stops following, reads as missing and closes its tab', async () => {
	server.deleted = true;
	emit({ type: 'heartbeat', status: 'passed' });
	await flush();

	expect(useReview.getState().status).toBe('missing');
	expect(sources.at(-1)?.readyState).toBe(FakeEventSource.CLOSED);
	expect(useShell.getState().tabs.some((tab) => tab.id === 'rv-1')).toBe(false);
});

test('a review the page cannot build fails the load as the page’s fault, never as a server that is down', async () => {
	const logged: unknown[] = [];
	const log = console.error;

	console.error = (error: unknown) => logged.push(error);
	leave();
	server.review = { ...server.review, findings: [{ id: 'broken', severity: 'high' }] } as unknown as Review;
	await open();
	console.error = log;

	expect(useReview.getState()).toMatchObject({ status: 'failed', loadError: { kind: 'other' } });
	expect(logged).toHaveLength(1);
});

test('an answer that is not a review fails the load as one the server sent, so Try again loads it', async () => {
	const { error, warn } = console;

	console.error = () => {};
	console.warn = () => {};
	leave();

	for (const body of ['null', '<!doctype html>', '{"id":']) {
		server.answers = (path) => (path === '/api/reviews/rv-1' ? Promise.resolve(new Response(body)) : null);
		await open();

		expect(useReview.getState()).toMatchObject({ status: 'failed', loadError: { kind: 'server' } });
	}

	Object.assign(console, { error, warn });
	server.answers = null;
	await useReview.getState().retry();

	expect(useReview.getState().status).toBe('ready');
});

test('a return visit paints the kept copy before the server answers, then refreshes it in place', async () => {
	close();
	server.review = { ...server.review, status: 'passed', summary: 'Done.' };
	await openLater();

	expect(useReview.getState().status).toBe('ready');
	expect(useReview.getState().review?.summary).toBeNull();

	await flush();

	expect(useReview.getState().review?.summary).toBe('Done.');
});

test('a reload that opens at a file paints it only once its grammar had its short wait, while the skeleton is unseen', async () => {
	close();
	Object.assign(document, { documentElement: { hasAttribute: () => false } });
	await open(SAMPLE_DIFFS[0].path, false);

	expect(useReview.getState().status).toBe('loading');

	await flush();

	expect(useReview.getState()).toMatchObject({
		status: 'ready',
		selection: { kind: 'file', path: SAMPLE_DIFFS[0].path }
	});
});

test('a reload of the sample that opens at a file paints it only once its grammar had its short wait', async () => {
	close();
	Object.assign(document, { documentElement: { hasAttribute: () => false } });

	const stop = useReview.getState().load('sample', SAMPLE_DIFFS[0].path);

	expect(useReview.getState().status).toBe('loading');

	await flush();

	expect(useReview.getState()).toMatchObject({
		status: 'ready',
		sample: true,
		selection: { kind: 'file', path: SAMPLE_DIFFS[0].path }
	});

	stop();
});

test('a return visit from another page opens at a file at once, with no skeleton in between', async () => {
	close();
	await open(SAMPLE_DIFFS[0].path, false);

	expect(useReview.getState()).toMatchObject({
		status: 'ready',
		selection: { kind: 'file', path: SAMPLE_DIFFS[0].path }
	});
});

test('a return visit that cannot refresh marks the copy stale from when it was kept, until the next answer', async () => {
	const keptAt = Date.now();

	close();
	server.answers = (path) => (path === '/api/reviews/rv-1' ? unreachable() : null);
	await openLater();
	await flush();

	expect(useReview.getState().staleSince).toBeGreaterThanOrEqual(keptAt);
	expect(useReview.getState().staleSince).toBeLessThan(keptAt + 1000);

	server.answers = null;
	await useReview.getState().refresh();

	expect(useReview.getState().staleSince).toBeNull();
});

test('a finished review kept moments ago is not read again; the stream’s first snapshot brings it up to date', async () => {
	leave();
	server.review = { ...server.review, status: 'passed', summary: 'Done.' };
	await open();
	close();
	server.review = { ...server.review, summary: 'Done again.' };
	server.fetched.length = 0;
	await open();

	expect(server.fetched.filter((path) => path === '/api/reviews/rv-1' || path.endsWith('/files'))).toEqual([]);

	emit({ type: 'snapshot', snapshot: emptyReviewProgress('rv-1'), review: server.review } as ProgressMessage);

	expect(useReview.getState().review?.summary).toBe('Done again.');
});
