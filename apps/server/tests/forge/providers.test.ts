import { describe, expect, test } from 'bun:test';
import { locateRepo, parseSlug } from '../../src/forge/providers';

describe('parseSlug', () => {
	test('strips hosts, users, and .git', () => {
		expect(parseSlug('https://github.com/o/r')).toBe('o/r');
		expect(parseSlug('git@github.com:o/r.git')).toBe('o/r');
		expect(parseSlug('https://gitlab.com/a/b/c')).toBe('a/b/c');
		expect(parseSlug('o/r')).toBe('o/r');
	});

	test('rejects garbage', () => {
		expect(() => parseSlug('not a url')).toThrow();
		expect(() => parseSlug('https://github.com/onlyone')).toThrow();
	});

	test('keeps spaces in a local file path but not in a hosted slug', () => {
		expect(parseSlug('file:///tmp/my repo')).toBe('tmp/my repo');
		expect(() => parseSlug('https://github.com/o/r x')).toThrow();
		expect(() => parseSlug('https://gitlab.com/a b/c')).toThrow();
		expect(() => parseSlug('file://')).toThrow();
	});
});

describe('locateRepo', () => {
	test('pairs provider with slug', () => {
		expect(locateRepo('https://github.com/o/r')).toEqual({ provider: 'github', slug: 'o/r' });
		expect(locateRepo('https://gitlab.com/a/b/c')).toEqual({ provider: 'gitlab', slug: 'a/b/c' });
	});

	test('rejects non owner/repo github slugs', () => {
		expect(() => locateRepo('https://github.com/a/b/c')).toThrow();
	});

	test('locates a local repo whose file path has a space', () => {
		expect(locateRepo('file:///tmp/my repo')).toEqual({ provider: 'local', slug: 'tmp/my repo' });
	});
});
