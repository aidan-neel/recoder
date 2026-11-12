import { beforeEach, describe, expect, test } from 'bun:test';

import { fetchQueue, forgetPulls, retryDelay } from '../../src/lib/queue/queue-fetch';
import { repoNames } from '../../src/lib/review/repo-names';
import { pull, repo } from './fixtures';

const REPO = repo('r1', 'acme/api');

const PULL = pull(1);

/** Requests made, by path, and how the pull request list answers. */
let calls: string[];
let pulls: () => Response;

/** True when the repository list answers a moment after everything else, as over a real network. */
let slowRepos: boolean;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
	calls = [];
	pulls = () => json([PULL]);
	slowRepos = false;
	forgetPulls();

	Object.assign(globalThis, {
		fetch: async (input: string | URL) => {
			const path = new URL(String(input)).pathname;

			calls.push(path);

			if (path === '/api/repos' && slowRepos) await new Promise((resolve) => setTimeout(resolve, 5));
			if (path === '/api/repos') return json([REPO]);
			if (path === '/api/repos/r1/pulls') return pulls();
			if (path === '/api/reviews/progress-summaries') return json({});

			return json([]);
		}
	});
});

describe('queue fetch', () => {
	test('a refresh within a minute reads the review list again but reuses the pull requests', async () => {
		await fetchQueue([], false);
		await fetchQueue([REPO], false);

		expect(calls.filter((path) => path === '/api/reviews')).toHaveLength(2);
		expect(calls.filter((path) => path === '/api/repos/r1/pulls')).toHaveLength(1);
	});

	test('a forge that refuses the token costs only that repository, with the kind of failure kept', async () => {
		pulls = () => json({ error: 'Bad credentials', kind: 'auth' }, 502);

		const data = await fetchQueue([], false);

		expect(data.pulls).toEqual([null]);
		expect(data.missing).toMatchObject([{ name: 'acme/api', provider: 'github', kind: 'auth' }]);
	});

	test('a failed pull request list is asked for again on the next refresh', async () => {
		pulls = () => json({ error: 'gh failed' }, 502);
		await fetchQueue([], false);

		pulls = () => json([PULL]);

		const data = await fetchQueue([REPO], false);

		expect(data.missing).toEqual([]);
		expect(data.pulls[0]?.map((item) => item.number)).toEqual([1]);
	});

	test('a known repository whose pull requests fail before the repository list lands is asked once', async () => {
		pulls = () => json({ error: 'Bad credentials', kind: 'auth' }, 502);
		slowRepos = true;

		const data = await fetchQueue([REPO], false);

		expect(calls.filter((path) => path === '/api/repos/r1/pulls')).toHaveLength(1);
		expect(data.missing).toMatchObject([{ name: 'acme/api', kind: 'auth' }]);
	});

	test('a review page opened after the queue loaded takes the repository names from that load, with no second request', async () => {
		await fetchQueue([], false);

		const names = await repoNames();

		expect(names.get('r1')).toBe('acme/api');
		expect(calls.filter((path) => path === '/api/repos')).toHaveLength(1);
	});

	test('failed loads retry after 1, 2, 4 and 8 seconds, then every 15', () => {
		expect([1, 2, 3, 4, 5, 9].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 15_000, 15_000]);
	});
});
