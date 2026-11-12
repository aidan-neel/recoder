import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Review } from '@recoder/shared';
import { toast } from '@recoder/ui';

import { stateOf } from '../../src/lib/review/decisions';
import { surfaceOf, useReview } from '../../src/lib/review/review-store';
import { SAMPLE_DIFFS } from '../../src/lib/sample/sample-diff';
import { useShell } from '../../src/lib/shell/shell-store';
import { flush } from '../fixtures';
import { diffDone, emit, held, json, leave, loadGrammars, open, serve, server, unserve } from './review-server';

/** The review as the server has it a moment later: the same review with `changes`, stamped newer. */
function later(changes: Partial<Review>, ms = 1000): Review {
	return { ...server.review, ...changes, updatedAt: new Date(Date.parse(server.review.updatedAt) + ms).toISOString() };
}

/** Holds the next read of the review until the returned release, then answers with the server's review as it is then. */
function holdNextReview(): () => void {
	const hold = held();
	let taken = false;

	server.answers = (path) => {
		if (taken || path !== '/api/reviews/rv-1') return null;

		taken = true;

		return hold.wait.then(() => json(server.review));
	};

	return hold.release;
}

beforeAll(loadGrammars);
beforeEach(serve);
afterEach(unserve);

describe('review store', () => {
	test('a rerun that drops the selected decision falls back to the overview', () => {
		const decision = surfaceOf(useReview.getState())?.decisions[0];

		useReview.getState().select({ kind: 'decision', id: decision?.id ?? '' });
		emit({ type: 'review', review: later({ findings: [], questions: undefined }) });

		expect(useReview.getState().selection).toEqual({ kind: 'overview' });
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

		leave();
		server.diffs = [];
		await open(path);

		expect(useReview.getState().selection).toEqual({ kind: 'overview' });

		server.diffs = SAMPLE_DIFFS;
		diffDone();
		await flush();

		expect(useReview.getState().selection).toEqual({ kind: 'file', path });
	});

	test('a tab keeps its repository and title while the page has not looked them up', async () => {
		leave();
		useShell.getState().openTab({ id: 'rv-1', repo: 'acme/api', pr: 214, title: 'Rate limits', open: 0, high: false });
		server.review = { ...server.review, prTitle: null };
		await open();

		expect(useShell.getState().tabs.find((tab) => tab.id === 'rv-1')).toMatchObject({
			repo: 'acme/api',
			title: 'Rate limits'
		});
	});

	test('a decision another tab saves shows here, and this tab’s next decision keeps it', async () => {
		const [first, second] = surfaceOf(useReview.getState())?.decisions ?? [];
		const otherTab = new EventTarget();
		const key = `recoder.decisions.v1.rv-1@${server.review.headSha}`;

		leave();
		Object.assign(globalThis, { window: otherTab });
		await open();

		localStorage.setItem(key, JSON.stringify({ [first.id]: { state: 'accepted', note: '', at: 1 } }));
		otherTab.dispatchEvent(Object.assign(new Event('storage'), { key }));

		expect(stateOf(useReview.getState().records, first.id)).toBe('accepted');

		useReview.getState().decide(second.id, 'sent');

		expect(Object.keys(JSON.parse(localStorage.getItem(key) ?? '{}')).sort()).toEqual([first.id, second.id].sort());
	});

	test('an older refresh that answers last never replaces the newer review', async () => {
		const first = server.review;
		const release = holdNextReview();
		const older = useReview.getState().refresh();

		await new Promise((resolve) => setTimeout(resolve, 1));
		server.review = later({ status: 'passed', summary: 'Done.' });
		await useReview.getState().refresh();
		server.review = first;
		release();
		await older;

		expect(useReview.getState().review?.status).toBe('passed');
	});

	test('a refresh asked before a stream update arrives still lands when it answers with a newer review', async () => {
		const release = holdNextReview();
		const refresh = useReview.getState().refresh();

		emit({ type: 'review', review: later({ summary: 'From the stream.' }, 500) });
		server.review = later({ status: 'passed', summary: 'From the refresh.' });
		release();
		await refresh;

		expect(useReview.getState().review?.summary).toBe('From the refresh.');
	});

	test('turning a quieted topic back on moves all its findings into the decisions, even ones the server did not name', async () => {
		const success = spyOn(toast, 'success').mockImplementation(() => 'toast');
		const topic = surfaceOf(useReview.getState())?.quieted[0];
		const [first, second] = topic?.decisions ?? [];

		server.answers = (path) =>
			path === `/api/reviews/rv-1/quieted/${encodeURIComponent(topic?.id ?? '')}`
				? Promise.resolve(json({ unquieted: [first.id] }))
				: null;

		await useReview.getState().turnTopicBackOn(topic?.id ?? '');
		success.mockRestore();

		const surface = surfaceOf(useReview.getState());

		expect(surface?.quieted).toEqual([]);
		expect(surface?.decisions.map((decision) => decision.id)).toContain(second.id);
	});
});
