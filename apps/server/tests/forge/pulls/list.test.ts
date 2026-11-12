import { afterAll, afterEach, expect, spyOn, test } from 'bun:test';
import type { PullRequest, Repo } from '@recoder/shared';
import { GhError } from '../../../src/forge/cli';
import { listOpenPulls } from '../../../src/forge/pulls/list';
import type { OpenPulls, PullEntry } from '../../../src/forge/pulls/status';
import { testReview } from '../../helpers/review';

function repo(id: string): Repo {
	return {
		id,
		name: id,
		url: `https://github.com/o/${id}`,
		provider: 'github',
		defaultBranch: 'main',
		createdAt: '',
		updatedAt: ''
	};
}

const warn = spyOn(console, 'warn').mockImplementation(() => undefined);

afterEach(() => {
	warn.mockClear();
});

afterAll(() => {
	warn.mockRestore();
});

/** A forge's whole open list: nothing was cut. */
function whole(...entries: PullEntry[]): OpenPulls {
	return { entries, truncated: false };
}

function entry(number: number, updatedAt: string): PullEntry {
	const pull: PullRequest = {
		number,
		title: `PR ${number}`,
		url: '',
		author: 'al',
		base: 'main',
		headRef: 'feat',
		headSha: 'abc',
		additions: 0,
		deletions: 0,
		changedFiles: 0,
		createdAt: updatedAt
	};

	return {
		pull,
		status: { state: 'open', draft: false, mergeability: 'clean', updatedAt, checks: null, commits: null }
	};
}

test('a repository whose forge fails is named in failures and the others still load', async () => {
	const load = async (r: Repo) => {
		if (r.id === 'b') throw new GhError('auth', 'gh not authenticated: token ghp_secret in /home/al/.config');

		return whole(entry(1, '2026-11-01T00:00:00Z'));
	};

	const list = await listOpenPulls([repo('a'), repo('b'), repo('c')], [], load);

	expect(list.items.map((item) => item.repoId).sort()).toEqual(['a', 'c']);
	expect(list.failures).toEqual([{ repoId: 'b', error: expect.any(String) }]);
	expect(list.failures[0].error).not.toContain('ghp_secret');
	expect(list.failures[0].error).not.toContain('/home/al');
	expect(list.truncatedRepoIds).toBeUndefined();
});

test('a failure is logged without the credentials the forge output quotes', async () => {
	const remote = 'https://octo:ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/o/b';

	await listOpenPulls([repo('b')], [], async () => {
		throw new GhError('unknown', `fatal: unable to access '${remote}': 502`);
	});

	expect(warn).toHaveBeenCalledTimes(1);
	expect(JSON.stringify(warn.mock.calls)).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123');
});

test('a repository whose forge list was cut is named in truncatedRepoIds', async () => {
	const load = async (r: Repo): Promise<OpenPulls> => ({
		entries: [entry(1, '2026-11-01T00:00:00Z')],
		truncated: r.id === 'b'
	});

	const list = await listOpenPulls([repo('a'), repo('b')], [], load);

	expect(list.truncatedRepoIds).toEqual(['b']);
	expect(list.items).toHaveLength(2);
});

test('pull requests sort by their newest activity across repositories', async () => {
	const pulls: Record<string, OpenPulls> = {
		a: whole(entry(1, '2026-11-01T00:00:00Z'), entry(2, '2026-11-05T00:00:00Z')),
		b: whole(entry(3, '2026-11-03T00:00:00Z'))
	};

	const list = await listOpenPulls([repo('a'), repo('b')], [], async (r) => pulls[r.id]);

	expect(list.items.map((item) => item.pull.number)).toEqual([2, 3, 1]);
});

test('each pull request joins its newest review, and a real review outranks a newer draft', async () => {
	const passed = testReview({ repoId: 'a', prNumber: 1, status: 'passed', updatedAt: '2026-11-01T00:00:00Z' });
	const draft = testReview({ repoId: 'a', prNumber: 1, status: 'draft', updatedAt: '2026-11-04T00:00:00Z' });
	const other = testReview({ repoId: 'a', prNumber: 9, updatedAt: '2026-11-04T00:00:00Z' });

	const list = await listOpenPulls([repo('a')], [passed, draft, other], async () =>
		whole(entry(1, '2026-11-02T00:00:00Z'), entry(2, '2026-11-01T00:00:00Z'))
	);

	expect(list.items.map((item) => item.review?.id ?? null)).toEqual([passed.id, null]);
});
