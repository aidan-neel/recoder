import { describe, expect, test } from 'bun:test';

import { forgeFileUrl } from '../../src/lib/files/forge-file-url';

const GITHUB = { url: 'https://github.com/acme/api', provider: 'github', defaultBranch: 'main' } as const;
const GITLAB = { url: 'https://gitlab.com/acme/api.git', provider: 'gitlab', defaultBranch: 'main' } as const;

describe('forgeFileUrl', () => {
	test('names the default branch when the chat has no ref', () => {
		const url = forgeFileUrl({ repo: GITHUB, ref: undefined, file: { path: 'src/a b.ts' } });

		expect(url).toBe('https://github.com/acme/api/blob/main/src/a%20b.ts');
	});

	test('marks a GitHub line range with a second L', () => {
		const file = { path: 'src/a.ts', startLine: 4, endLine: 9 };

		expect(forgeFileUrl({ repo: GITHUB, ref: 'abc123', file })).toBe(
			'https://github.com/acme/api/blob/abc123/src/a.ts#L4-L9'
		);
	});

	test('marks a GitLab range without it, and reads a .git address', () => {
		const file = { path: 'src/a.ts', startLine: 4, endLine: 9 };

		expect(forgeFileUrl({ repo: GITLAB, ref: undefined, file })).toBe(
			'https://gitlab.com/acme/api/-/blob/main/src/a.ts#L4-9'
		);
	});

	test('marks one line once when the range ends where it starts', () => {
		const file = { path: 'src/a.ts', startLine: 4, endLine: 4 };

		expect(forgeFileUrl({ repo: GITHUB, ref: undefined, file })).toEndWith('#L4');
	});

	test('has no address for a local repository', () => {
		const repo = { url: '/home/me/api', provider: 'local', defaultBranch: 'main' } as const;

		expect(forgeFileUrl({ repo, ref: undefined, file: { path: 'a.ts' } })).toBeNull();
	});
});
