import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import type { PullRequest, Repo, Review } from '@recoder/shared';

import { OFFLINE_TEXT } from '../../src/lib/api/http';
import { useQueue } from '../../src/lib/queue/queue-store';
import { useShell } from '../../src/lib/shell/shell-store';
import { flush, memoryStorage } from '../fixtures';
import { pull, repo } from './fixtures';

/** What the fake review server answers; each test changes it. */
interface Server {
	repos: Repo[];
	pulls: Record<string, PullRequest[]>;
	reviews: Review[];
	/** The review list never reaches the server, as when it is down. */
	failReviews: boolean;
	/** The review list is answered with this error body and a 500. */
	reviewsError: string | null;
	/** Repositories whose pull requests the forge refuses for a bad token. */
	failPulls: string[];
	/** While set, GET /api/reviews waits for it, so a test can hold a refresh in flight. */
	hold: Promise<void> | null;
	/** How many times the review list was asked for. */
	reviewCalls: number;
}

let server: Server;
let stop: () => void = () => {};

function queued(repoId: string, number: number): Review {
	return {
		id: `rv-${number}`,
		repoId,
		prNumber: number,
		headSha: `sha${number}`,
		status: 'queued',
		summary: null,
		findings: [],
		runs: [],
		source: 'github',
		prTitle: null,
		prUrl: null,
		createdAt: '2026-10-13T09:00:00Z',
		updatedAt: '2026-10-13T09:00:00Z'
	};
}

/** A finished review of the pull request with one open high finding. */
function passed(repoId: string, number: number): Review {
	return {
		...queued(repoId, number),
		status: 'passed',
		updatedAt: '2026-10-13T10:00:00Z',
		findings: [{ id: 'f1', file: 'src/a.ts', line: 1, severity: 'error', message: 'Broken.' }]
	};
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** The review list's answer, or the failure the test asked for. */
async function reviewList(): Promise<Response> {
	server.reviewCalls += 1;
	await server.hold;

	if (server.failReviews) throw new TypeError('Failed to fetch');
	if (server.reviewsError) return json({ error: server.reviewsError }, 500);

	return json(server.reviews);
}

/** The review server's answer to one request. */
async function answer(path: string, method: string): Promise<Response> {
	const pulls = path.match(/^\/api\/repos\/([^/]+)\/pulls$/);

	if (path === '/api/repos') return json(server.repos);

	if (pulls) {
		return server.failPulls.includes(pulls[1])
			? json({ error: 'Bad credentials', kind: 'auth' }, 502)
			: json(server.pulls[pulls[1]]);
	}

	if (path === '/api/reviews/progress-summaries') return json({});
	if (path === '/api/reviews' && method === 'POST') return json(queued('r1', 1), 201);
	if (path === '/api/reviews') return reviewList();

	return json({ error: 'not found' }, 404);
}

/** Lets every pending fetch, state update and save settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const entry = (number: number) => useQueue.getState().entries.find((item) => item.pull.number === number);

const numbers = () => useQueue.getState().entries.map((item) => item.pull.number);

/** Shows or hides the browser tab, as switching to another tab does. */
function showTab(state: 'visible' | 'hidden'): void {
	Object.assign(document, { visibilityState: state });
	document.dispatchEvent(new Event('visibilitychange'));
}

/** Holds the review list until the returned function is called. */
function holdReviews(): () => void {
	let release = () => {};

	server.hold = new Promise((resolve) => (release = resolve));

	return release;
}

beforeEach(() => {
	server = {
		repos: [repo('r1', 'acme/api'), repo('r2', 'acme/web')],
		pulls: { r1: [pull(1)], r2: [pull(2)] },
		reviews: [],
		failReviews: false,
		reviewsError: null,
		failPulls: [],
		hold: null,
		reviewCalls: 0
	};

	Object.assign(globalThis, {
		document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
		window: new EventTarget(),
		localStorage: memoryStorage(),
		fetch: (input: string | URL, init?: RequestInit) => answer(new URL(String(input)).pathname, init?.method ?? 'GET')
	});

	useQueue.getState().reset();
	stop = useQueue.getState().load(false);
});

afterEach(() => stop());

describe('queue store', () => {
	test('a refresh that fails after a good load keeps the list and says what failed', async () => {
		await settle();
		server.failReviews = true;

		expect(await useQueue.getState().refresh()).toBe(false);
		expect(useQueue.getState()).toMatchObject({ status: 'ready', error: OFFLINE_TEXT });
		expect(numbers()).toEqual([1, 2]);
	});

	test('a first load the server answers with an error reads as failed with its reason, not offline', async () => {
		stop();
		useQueue.getState().reset();
		server.reviewsError = 'The review database is busy.';
		stop = useQueue.getState().load(false);
		await settle();

		expect(useQueue.getState()).toMatchObject({ status: 'failed', error: 'The review database is busy.' });
	});

	test('a first load that never reaches the server reads as offline, and the network coming back loads it', async () => {
		stop();
		useQueue.getState().reset();
		server.failReviews = true;
		stop = useQueue.getState().load(false);
		await settle();

		expect(useQueue.getState().status).toBe('offline');

		server.failReviews = false;
		window.dispatchEvent(new Event('online'));
		await settle();

		expect(useQueue.getState()).toMatchObject({ status: 'ready', error: null });
	});

	test('the network dropping shows over the list at once, without waiting for the next refresh', async () => {
		await settle();
		window.dispatchEvent(new Event('offline'));

		expect(useQueue.getState()).toMatchObject({ status: 'ready', error: OFFLINE_TEXT });
		expect(numbers()).toEqual([1, 2]);
	});

	test('a repository whose token the forge refuses keeps its last rows and says why', async () => {
		await settle();
		server.failPulls = ['r2'];

		await useQueue.getState().refresh();

		expect(numbers()).toEqual([1, 2]);
		expect(useQueue.getState().missing).toMatchObject([{ name: 'acme/web', provider: 'github', kind: 'auth' }]);
	});

	test('a refresh that began before a review started does not put the row back', async () => {
		await settle();

		const release = holdReviews();
		const slow = useQueue.getState().refresh();

		await useQueue.getState().start(entry(1)!);
		expect(entry(1)?.state).toBe('reviewing');

		release();
		await slow;

		expect(entry(1)?.state).toBe('reviewing');
	});

	test('a refresh that finds nothing new keeps the same entries, so no row renders again', async () => {
		await settle();

		const before = useQueue.getState().entries;

		await useQueue.getState().refresh();

		expect(useQueue.getState().entries).toBe(before);
	});

	test('a review that finishes while the queue shows stops its tab spinning', async () => {
		server.reviews = [queued('r1', 1)];

		useShell.setState({
			tabs: [{ id: 'rv-1', repo: 'acme/api', pr: 1, title: 'PR 1', open: null, high: false, seenAt: 1 }]
		});

		await useQueue.getState().refresh();

		server.reviews = [passed('r1', 1)];
		await useQueue.getState().refresh();

		expect(useShell.getState().tabs[0]).toMatchObject({
			open: 1,
			high: true,
			url: 'https://github.com/acme/api/pull/1'
		});
	});

	test('a refresh that answers after the sample queue opened leaves the sample rows alone', async () => {
		await settle();

		const release = holdReviews();
		const slow = useQueue.getState().refresh();

		stop();
		stop = useQueue.getState().load(true);
		release();
		await slow;

		expect(useQueue.getState().sample).toBe(true);
		expect(entry(1)).toBeUndefined();
	});

	test('a page mounted again while its first load runs joins that load instead of asking again', async () => {
		stop();
		useQueue.getState().reset();
		server.reviewCalls = 0;

		const release = holdReviews();

		stop = useQueue.getState().load(false);
		await settle();
		stop();
		stop = useQueue.getState().load(false);
		release();
		await settle();

		expect(server.reviewCalls).toBe(1);
		expect(numbers()).toEqual([1, 2]);
	});

	test('the list the last visit saved paints at once, and the refresh confirms it once the page is idle', async () => {
		await settle();
		stop();
		useQueue.setState({ status: 'loading', entries: [] });
		server.reviewCalls = 0;

		const idle: (() => void)[] = [];

		Object.assign(globalThis, { requestIdleCallback: (run: () => void) => idle.push(run), cancelIdleCallback() {} });
		stop = useQueue.getState().load(false);

		expect(useQueue.getState()).toMatchObject({ status: 'ready', restored: true });
		expect(numbers()).toEqual([1, 2]);

		await settle();

		expect(server.reviewCalls).toBe(0);

		idle.forEach((run) => run());
		await settle();

		expect(useQueue.getState().restored).toBe(false);

		stop();
		stop = () => {};
		Reflect.deleteProperty(globalThis, 'requestIdleCallback');
		Reflect.deleteProperty(globalThis, 'cancelIdleCallback');
	});

	test('a list with no rows, one of two repositories failing, still covers both after a reload', async () => {
		await settle();
		stop();
		useQueue.getState().reset();
		server.pulls = { r1: [], r2: [] };
		server.failPulls = ['r1'];
		stop = useQueue.getState().load(false);
		await settle();

		expect(useQueue.getState()).toMatchObject({ status: 'ready', entries: [], tracked: 2 });
		expect(useQueue.getState().missing).toHaveLength(1);

		stop();
		useQueue.setState({ status: 'loading', entries: [], missing: [], tracked: 0 });
		stop = useQueue.getState().load(false);

		expect(useQueue.getState()).toMatchObject({ restored: true, tracked: 2 });
		expect(useQueue.getState().missing).toHaveLength(1);
	});

	test('a saved list too old to paint still has its pull requests asked for beside the repository list', async () => {
		await settle();
		stop();

		const saved = JSON.parse(localStorage.getItem('recoder.app.queue.v1') ?? '{}') as Record<string, unknown>;
		const asked: string[] = [];
		let releaseRepos = () => {};
		const repos = new Promise<void>((resolve) => (releaseRepos = resolve));

		useQueue.getState().reset();
		localStorage.setItem('recoder.app.queue.v1', JSON.stringify({ ...saved, at: Date.now() - 25 * 60 * 60 * 1000 }));

		Object.assign(globalThis, {
			fetch: async (input: string | URL, init?: RequestInit) => {
				const path = new URL(String(input)).pathname;

				asked.push(path);

				if (path === '/api/repos') await repos;

				return answer(path, init?.method ?? 'GET');
			}
		});

		stop = useQueue.getState().load(false);
		await settle();

		expect(useQueue.getState().status).toBe('loading');
		expect(asked).toEqual(expect.arrayContaining(['/api/repos/r1/pulls', '/api/repos/r2/pulls']));

		releaseRepos();
		await settle();

		expect(numbers()).toEqual([1, 2]);
		expect(asked.filter((path) => path.endsWith('/pulls'))).toHaveLength(2);
	});
});

describe('queue refresh timing', () => {
	beforeEach(async () => {
		await settle();
		stop();
		jest.useFakeTimers();
		useQueue.getState().reset();
		stop = useQueue.getState().load(false);
		await flush();
	});

	afterEach(() => {
		stop();
		stop = () => {};
		jest.useRealTimers();
	});

	test('a hidden tab asks the server nothing, and refreshes as soon as it shows again', async () => {
		const before = server.reviewCalls;

		showTab('hidden');
		jest.advanceTimersByTime(60_000);
		await flush();

		expect(server.reviewCalls).toBe(before);

		showTab('visible');
		await flush();

		expect(server.reviewCalls).toBe(before + 1);
	});

	test('a list that missed its refreshes says how old it is only once a refresh has gone two seconds unanswered', async () => {
		jest.setSystemTime(Date.now() + 60_000);

		const release = holdReviews();

		void useQueue.getState().refresh();
		jest.advanceTimersByTime(1900);

		expect(useQueue.getState().stale).toBe(false);

		jest.advanceTimersByTime(100);

		expect(useQueue.getState().stale).toBe(true);

		release();
		await flush();

		expect(useQueue.getState()).toMatchObject({ status: 'ready', stale: false });
	});
});
