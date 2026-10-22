import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { PullRequest, Repo, Review } from '@recoder/shared';

import { useQueue } from '../../src/lib/queue/queue-store';
import { useShell } from '../../src/lib/shell/shell-store';

/** What the fake review server answers; each test changes it. */
interface Server {
	repos: Repo[];
	pulls: Record<string, PullRequest[]>;
	reviews: Review[];
	failReviews: boolean;
	failPulls: string[];
	/** While set, GET /api/reviews waits for it, so a test can hold a refresh in flight. */
	hold: Promise<void> | null;
}

let server: Server;
let stop: () => void = () => {};

function repo(id: string, name: string): Repo {
	return {
		id,
		name,
		url: `https://github.com/${name}`,
		provider: 'github',
		defaultBranch: 'main',
		createdAt: '',
		updatedAt: ''
	};
}

function pull(number: number): PullRequest {
	return {
		number,
		title: `PR ${number}`,
		url: `https://github.com/acme/api/pull/${number}`,
		author: 'claude[bot]',
		base: 'main',
		headRef: `agent/pr-${number}`,
		headSha: `sha${number}`,
		additions: 1,
		deletions: 1,
		changedFiles: 1,
		createdAt: '2026-10-13T09:00:00Z'
	};
}

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

/** The review server's answer to one request. */
async function answer(path: string, method: string): Promise<Response> {
	const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
	const pulls = path.match(/^\/api\/repos\/([^/]+)\/pulls$/);

	if (path === '/api/repos') return json(server.repos);
	if (pulls)
		return server.failPulls.includes(pulls[1]) ? json({ error: 'gh failed' }, 502) : json(server.pulls[pulls[1]]);
	if (path === '/api/reviews/progress-summaries') return json({});

	if (path === '/api/reviews' && method === 'POST') return json(queued('r1', 1), 201);

	if (path === '/api/reviews') {
		await server.hold;

		if (server.failReviews) throw new TypeError('Failed to fetch');

		return json(server.reviews);
	}

	return json({ error: 'not found' }, 404);
}

/** Lets every pending fetch and state update settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const entry = (number: number) => useQueue.getState().entries.find((item) => item.pull.number === number);

beforeEach(() => {
	server = {
		repos: [repo('r1', 'acme/api'), repo('r2', 'acme/web')],
		pulls: { r1: [pull(1)], r2: [pull(2)] },
		reviews: [],
		failReviews: false,
		failPulls: [],
		hold: null
	};

	Object.assign(globalThis, {
		document: { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' },
		fetch: (input: string | URL, init?: RequestInit) => answer(new URL(String(input)).pathname, init?.method ?? 'GET')
	});

	useQueue.setState({ status: 'loading', entries: [], stale: false, missing: [] });
	stop = useQueue.getState().load(false);
});

afterEach(() => stop());

describe('queue store', () => {
	test('a refresh that fails after a good load keeps the list and marks it stale', async () => {
		await settle();
		server.failReviews = true;

		expect(await useQueue.getState().refresh()).toBe(false);
		expect(useQueue.getState()).toMatchObject({ status: 'ready', stale: true });
		expect(useQueue.getState().entries.map((item) => item.pull.number)).toEqual([1, 2]);
	});

	test('a repository whose pull requests fail to load keeps its last rows', async () => {
		await settle();
		server.failPulls = ['r2'];

		await useQueue.getState().refresh();

		expect(useQueue.getState().entries.map((item) => item.pull.number)).toEqual([1, 2]);
		expect(useQueue.getState().missing).toEqual(['acme/web']);
	});

	test('a refresh that began before a review started does not put the row back', async () => {
		await settle();

		let release = () => {};

		server.hold = new Promise((resolve) => (release = resolve));

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

	test('a background refresh that answers after the sample queue opened leaves the sample rows alone', async () => {
		await settle();

		const unwatch = useQueue.getState().watch(false);
		let release = () => {};

		stop();
		server.hold = new Promise((resolve) => (release = resolve));

		const slow = useQueue.getState().refresh();

		stop = useQueue.getState().load(true);
		release();
		await slow;

		expect(useQueue.getState().sample).toBe(true);
		expect(entry(1)).toBeUndefined();

		unwatch();
	});
});
