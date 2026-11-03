import { expect, test } from 'bun:test';
import type { RepoFileHost } from '../../../src/forge/repo-files';
import { proposalPath, readRepoGuidelinesFile } from '../../../src/review/guidelines/repo-layer';

/** A host whose branches hold the given files, keyed by branch then path. */
function fakeHost(branches: Record<string, Record<string, string>>): RepoFileHost {
	return {
		canWrite: () => true,
		defaultBranch: async () => ({ branch: 'main', sha: 'abc' }),
		readFile: async (path, ref) => {
			const content = branches[ref]?.[path];

			return content === undefined ? null : { content };
		},
		findPending: async () => null,
		propose: async () => ({ number: 1, url: '', branch: '' })
	};
}

test('RECODER.md wins over .recoder/REVIEW.md when a branch has both', async () => {
	const host = fakeHost({ main: { 'RECODER.md': 'new', '.recoder/REVIEW.md': 'old' } });

	expect(await readRepoGuidelinesFile(host, 'main')).toEqual({ path: 'RECODER.md', content: 'new' });
});

test('a repository with only .recoder/REVIEW.md keeps reading and writing it', async () => {
	const host = fakeHost({ main: { '.recoder/REVIEW.md': 'old' } });

	expect(await readRepoGuidelinesFile(host, 'main')).toEqual({ path: '.recoder/REVIEW.md', content: 'old' });
	expect(await proposalPath(host, null)).toBe('.recoder/REVIEW.md');
});

test('a proposal follows the pending branch, and a repository with no file gets RECODER.md', async () => {
	const host = fakeHost({ main: {}, 'recoder/review-guidelines-1': { '.recoder/REVIEW.md': 'draft' } });

	expect(await readRepoGuidelinesFile(host, 'main')).toBeNull();
	expect(await proposalPath(host, null)).toBe('RECODER.md');
	expect(await proposalPath(host, 'recoder/review-guidelines-1')).toBe('.recoder/REVIEW.md');
});
