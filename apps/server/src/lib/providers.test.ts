import { describe, expect, test } from 'bun:test';
import { locateRepo, parseSlug } from './providers';

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
});

describe('locateRepo', () => {
	test('pairs provider with slug', () => {
		expect(locateRepo('https://github.com/o/r')).toEqual({ provider: 'github', slug: 'o/r' });
		expect(locateRepo('https://gitlab.com/a/b/c')).toEqual({ provider: 'gitlab', slug: 'a/b/c' });
	});

	test('rejects non owner/repo github slugs', () => {
		expect(() => locateRepo('https://github.com/a/b/c')).toThrow();
	});
});
