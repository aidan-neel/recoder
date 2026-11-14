import { expect, test } from 'bun:test';
import { cleanRepoPath, isRepoRef } from '../../src/repo-files/paths';

test('a clean repository-relative path is kept, trailing slashes are dropped', () => {
	expect(cleanRepoPath('src/a.ts')).toBe('src/a.ts');
	expect(cleanRepoPath('src/dir/')).toBe('src/dir');
	expect(cleanRepoPath('.env')).toBe('.env');
	expect(cleanRepoPath('')).toBe('');
});

test('absolute paths, traversal, NUL and empty or dot segments are refused', () => {
	expect(cleanRepoPath('/etc/passwd')).toBeNull();
	expect(cleanRepoPath('../x')).toBeNull();
	expect(cleanRepoPath('a/../b')).toBeNull();
	expect(cleanRepoPath('..')).toBeNull();
	expect(cleanRepoPath('./a')).toBeNull();
	expect(cleanRepoPath('a/./b')).toBeNull();
	expect(cleanRepoPath('a//b')).toBeNull();
	expect(cleanRepoPath('a\0b')).toBeNull();
	expect(cleanRepoPath('a\tb')).toBeNull();
});

test('a ref may name branches, tags, refs and shas, never a flag or a range', () => {
	expect(isRepoRef('main')).toBe(true);
	expect(isRepoRef('refs/pull/7/head')).toBe(true);
	expect(isRepoRef('v1.2.3')).toBe(true);
	expect(isRepoRef('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b')).toBe(true);

	expect(isRepoRef('--all')).toBe(false);
	expect(isRepoRef('-x')).toBe(false);
	expect(isRepoRef('a..b')).toBe(false);
	expect(isRepoRef('main^{tree}')).toBe(false);
	expect(isRepoRef('HEAD~3')).toBe(false);
	expect(isRepoRef('main:src')).toBe(false);
	expect(isRepoRef('a;b')).toBe(false);
	expect(isRepoRef('a b')).toBe(false);
	expect(isRepoRef('@{u}')).toBe(false);
	expect(isRepoRef('')).toBe(false);
});
