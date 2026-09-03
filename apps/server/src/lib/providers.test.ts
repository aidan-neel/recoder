import { describe, expect, test } from 'bun:test';
import { detectProvider, locateRepo, parseSlug, refspecFor } from './providers';

describe('detectProvider', () => {
	test('github by default, gitlab by host', () => {
		expect(detectProvider('https://github.com/o/r')).toBe('github');
		expect(detectProvider('git@github.com:o/r.git')).toBe('github');
		expect(detectProvider('https://gitlab.com/o/r')).toBe('gitlab');
		expect(detectProvider('https://gitlab.example.com/o/r')).toBe('gitlab');
	});
});

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

describe('refspecFor', () => {
	test('github pull refs', () => {
		expect(refspecFor('github', 7)).toEqual({ fetchRef: 'pull/7/head:pr-7', branch: 'pr-7' });
	});

	test('gitlab mr refs', () => {
		expect(refspecFor('gitlab', 7)).toEqual({
			fetchRef: 'merge-requests/7/head:mr-7',
			branch: 'mr-7'
		});
	});
});
