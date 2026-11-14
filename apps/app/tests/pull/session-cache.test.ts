import { describe, expect, test } from 'bun:test';
import type { PullPage } from '@recoder/shared';

import type { ApiClient } from '../../src/lib/api/client';
import { createSessionCache } from '../../src/lib/pull/session-cache';
import { createListStore } from '../../src/lib/pulls/list-store';
import { createSampleApi } from '../../src/lib/sample/sample-api';

/** A pull request page's answer, enough for the session to hold it. */
function page(number: number): PullPage {
	return {
		provider: 'github',
		repoId: 'repo',
		pull: {
			number,
			title: 'Fix it',
			url: 'https://github.com/o/r/pull/7',
			author: 'al',
			base: 'main',
			headRef: 'fix',
			headSha: 'a'.repeat(40),
			additions: 1,
			deletions: 1,
			changedFiles: 1,
			createdAt: '2026-11-01T00:00:00Z'
		},
		status: { state: 'open', draft: false, mergeability: 'clean', updatedAt: '', checks: null, commits: null },
		capabilities: { comments: true, checks: false, mergeMethods: [] },
		review: null
	};
}

/** A client that counts page and diff reads; `held` keeps them pending until the test settles it. */
function countingClient(held?: PromiseWithResolvers<PullPage>) {
	const calls = { page: 0, diff: 0 };

	const client: ApiClient = {
		...createSampleApi(),
		pullPage: async (_repoId, number) => {
			calls.page++;

			return held ? held.promise : page(number);
		},
		pullDiff: async () => {
			calls.diff++;

			return { headSha: 'a'.repeat(40), files: [] };
		}
	};

	return { client, calls };
}

function cacheOf(client: ApiClient) {
	return createSessionCache(client, createListStore(client));
}

describe('pull request sessions kept between visits', () => {
	test('the same pull request answers with the same session', () => {
		const { client } = countingClient();
		const sessions = cacheOf(client);

		expect(sessions.get('repo', 7)).toBe(sessions.get('repo', 7));
		expect(sessions.get('repo', 7)).not.toBe(sessions.get('repo', 8));
		expect(sessions.get('repo', 7)).not.toBe(sessions.get('other', 7));
	});

	test('past eight kept, the least recently read session is forgotten', () => {
		const { client } = countingClient();
		const sessions = cacheOf(client);
		const first = sessions.get('repo', 1);

		for (let n = 2; n <= 9; n++) sessions.get('repo', n);

		expect(sessions.get('repo', 1)).not.toBe(first);
	});

	test('warming twice while the reads are running asks for each once', async () => {
		const held = Promise.withResolvers<PullPage>();
		const { client, calls } = countingClient(held);
		const sessions = cacheOf(client);

		sessions.warm('repo', 7);
		sessions.warm('repo', 7);

		held.resolve(page(7));
		await sessions.get('repo', 7).warm();

		expect(calls).toEqual({ page: 1, diff: 1 });
	});

	test('a session’s own load joins a warm already running', async () => {
		const held = Promise.withResolvers<PullPage>();
		const { client, calls } = countingClient(held);
		const sessions = cacheOf(client);

		sessions.warm('repo', 7);

		const joined = sessions.get('repo', 7).pages.loadPage();

		held.resolve(page(7));
		await joined;

		expect(calls.page).toBe(1);
	});

	test('warming a pull request whose page already loaded reads nothing', async () => {
		const { client, calls } = countingClient();
		const sessions = cacheOf(client);

		sessions.warm('repo', 7);
		await sessions.get('repo', 7).warm();
		sessions.warm('repo', 7);
		await Bun.sleep(0);

		expect(calls).toEqual({ page: 1, diff: 1 });
	});

	test('at most two hovers read their pages at once', async () => {
		const held = Promise.withResolvers<PullPage>();
		const { client, calls } = countingClient(held);
		const sessions = cacheOf(client);

		sessions.warm('repo', 1);
		sessions.warm('repo', 2);
		sessions.warm('repo', 3);

		expect(calls.page).toBe(2);

		held.resolve(page(3));
		await sessions.get('repo', 1).warm();

		sessions.warm('repo', 3);
		await sessions.get('repo', 3).warm();

		expect(calls.page).toBe(3);
	});
});
