import { afterEach, expect, mock, test } from 'bun:test';
import type { Repo } from '@recoder/shared';
import type { RepoFileHost } from '../../../src/forge/repo-files';
import { forgetRepoOverview, repoOverview } from '../../../src/review/guidelines/repo-overview';
import { clearAllCaches } from '../../../src/util/ttl-cache';

const repo: Repo = {
	id: 'overview-test',
	name: 'test',
	url: 'https://github.com/test/repo',
	provider: 'github',
	defaultBranch: 'main',
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString()
};

afterEach(clearAllCaches);

function fixture() {
	let content = 'Original';
	const head = mock(async () => ({ branch: 'main', sha: 'head' }));

	const host: RepoFileHost = {
		canWrite: () => true,
		defaultBranch: head,
		readFile: async () => ({ content }),
		findPending: async () => null,
		propose: async () => {
			throw new Error('unused');
		}
	};

	return {
		host,
		head,
		change: () => {
			content = 'Proposed';
		}
	};
}

test('concurrent guidelines reads share the forge lookup', async () => {
	const { host, head } = fixture();
	const [first, second] = await Promise.all([repoOverview(repo, host), repoOverview(repo, host)]);

	expect(first).toEqual(second);
	expect(head).toHaveBeenCalledTimes(1);
});

test('a proposal invalidates a previously cached guidelines overview', async () => {
	const { host, change } = fixture();

	expect((await repoOverview(repo, host)).content).toBe('Original');
	change();
	forgetRepoOverview(repo.id);
	expect((await repoOverview(repo, host)).content).toBe('Proposed');
});

test('a proposal invalidates a read that was already in flight', async () => {
	const { host } = fixture();
	const original = Promise.withResolvers<{ branch: string; sha: string }>();

	host.defaultBranch = () => original.promise;

	const pending = repoOverview(repo, host);

	forgetRepoOverview(repo.id);
	original.resolve({ branch: 'old', sha: 'old' });
	await pending;
	host.defaultBranch = async () => ({ branch: 'new', sha: 'new' });
	expect((await repoOverview(repo, host)).sha).toBe('new');
});
