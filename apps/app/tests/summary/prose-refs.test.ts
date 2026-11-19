import { describe, expect, test } from 'bun:test';
import type { PullCommit } from '@recoder/shared';

import { mayNameCommit, readProseRef, type ProseSources } from '../../src/lib/summary/prose-refs';

function commit(sha: string): PullCommit {
	return {
		sha,
		title: 'Renew the token under a lock',
		body: '',
		author: { login: 'maria', name: null, avatarUrl: null },
		authoredAt: '2026-11-18T10:00:00Z',
		url: null
	};
}

const LEASE_COMMIT = commit('9f3c1a7e2b4d5f60718293a4b5c6d7e8f9012345');

const SOURCES: ProseSources = {
	paths: ['src/session/lease.ts', 'src/session/index.ts', 'src/store/index.ts', 'Dockerfile', 'cmd/main'],
	commits: [LEASE_COMMIT]
};

describe('readProseRef', () => {
	test('a whole changed path is that file, named by its last part', () => {
		expect(readProseRef('src/session/lease.ts', SOURCES)).toEqual({
			kind: 'file',
			path: 'src/session/lease.ts',
			label: 'lease.ts'
		});
	});

	test('a file name alone is the one changed file that ends with it', () => {
		expect(readProseRef('lease.ts', SOURCES)).toMatchObject({ kind: 'file', path: 'src/session/lease.ts' });
	});

	test.each([
		['lease.ts:20', 'lease.ts:20'],
		['lease.ts:20-34', 'lease.ts:20-34'],
		['lease.ts:20:4', 'lease.ts:20'],
		['./src/session/lease.ts#L20', 'lease.ts:20'],
		['session/lease.ts#L20-L34', 'lease.ts:20-34']
	])('%s keeps its lines in the label', (code, label) => {
		expect(readProseRef(code, SOURCES)).toMatchObject({ kind: 'file', path: 'src/session/lease.ts', label });
	});

	test('a name two changed files share is not a file', () => {
		expect(readProseRef('index.ts', SOURCES)).toBeNull();
	});

	test('a longer ending tells two files with one name apart', () => {
		expect(readProseRef('store/index.ts', SOURCES)).toMatchObject({ kind: 'file', path: 'src/store/index.ts' });
	});

	test('the end of a file name is not a file: a match starts at a folder', () => {
		expect(readProseRef('ts', SOURCES)).toBeNull();
		expect(readProseRef('ease.ts', SOURCES)).toBeNull();
	});

	test('a bare word is a file only as a whole path', () => {
		expect(readProseRef('Dockerfile', SOURCES)).toMatchObject({ kind: 'file', path: 'Dockerfile' });
		expect(readProseRef('main', SOURCES)).toBeNull();
	});

	test('a file the pull request does not change stays code', () => {
		expect(readProseRef('src/session/token.ts', SOURCES)).toBeNull();
	});

	test('a short or whole hash of one of the commits is that commit, in any case', () => {
		expect(readProseRef('9f3c1a7', SOURCES)).toEqual({ kind: 'commit', commit: LEASE_COMMIT });
		expect(readProseRef('9F3C1A7E2B', SOURCES)).toEqual({ kind: 'commit', commit: LEASE_COMMIT });
		expect(readProseRef(LEASE_COMMIT.sha, SOURCES)).toEqual({ kind: 'commit', commit: LEASE_COMMIT });
	});

	test('a hash of no commit here, or one too short to trust, stays code', () => {
		expect(readProseRef('1234567', SOURCES)).toBeNull();
		expect(readProseRef('9f3c1a', SOURCES)).toBeNull();
	});

	test('code that is neither stays code', () => {
		expect(readProseRef('renew()', SOURCES)).toBeNull();
		expect(readProseRef('', SOURCES)).toBeNull();
	});
});

describe('mayNameCommit', () => {
	test('only inline code shaped like a hash can name a commit', () => {
		expect(mayNameCommit('Reverts `9f3c1a7` for now.')).toBe(true);
		expect(mayNameCommit('Reverts 9f3c1a7 and sets `capacity`.')).toBe(false);
		expect(mayNameCommit('Sets `capacity` in `lease.ts`.')).toBe(false);
	});
});
