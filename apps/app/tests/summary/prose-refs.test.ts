import { describe, expect, test } from 'bun:test';
import type { PullCommit } from '@recoder/shared';

import {
	markFileRefs,
	mayNameCommit,
	mayNameFile,
	namedFiles,
	readProseRef,
	type ProseSources
} from '../../src/lib/summary/prose-refs';

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
	test('a whole changed path is that file, with no lines', () => {
		expect(readProseRef('src/session/lease.ts', SOURCES)).toEqual({
			kind: 'file',
			path: 'src/session/lease.ts',
			lines: null,
			line: null
		});
	});

	test('a file name alone is the one changed file that ends with it', () => {
		expect(readProseRef('lease.ts', SOURCES)).toMatchObject({ kind: 'file', path: 'src/session/lease.ts' });
	});

	test.each([
		['lease.ts:20', '20'],
		['lease.ts:20-34', '20-34'],
		['lease.ts:20:4', '20'],
		['./src/session/lease.ts#L20', '20'],
		['session/lease.ts#L20-L34', '20-34']
	])('%s keeps its lines, and opens at the first', (code, lines) => {
		expect(readProseRef(code, SOURCES)).toMatchObject({
			kind: 'file',
			path: 'src/session/lease.ts',
			lines,
			line: 20
		});
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
		expect(mayNameCommit('Up to <code>9f3c1a7</code> now.')).toBe(true);
		expect(mayNameCommit('Reverts 9f3c1a7 and sets `capacity`.')).toBe(false);
		expect(mayNameCommit('Sets `capacity` in `lease.ts`.')).toBe(false);
	});
});

describe('mayNameFile', () => {
	test('detects both backtick and HTML code spans', () => {
		expect(mayNameFile('Updated `lease.ts`.')).toBe(true);
		expect(mayNameFile('Updated <code>lease.ts</code>.')).toBe(true);
		expect(mayNameFile('Plain prose without code.')).toBe(false);
	});
});

const PATHS = SOURCES.paths;

describe('markFileRefs', () => {
	test('a changed file named in running text becomes a code span, its lines and the full stop after it kept apart', () => {
		expect(markFileRefs('See lease.ts:20-34. Then src/store/index.ts, too.', PATHS)).toBe(
			'See `lease.ts:20-34`. Then `src/store/index.ts`, too.'
		);
	});

	test('a file in a list item or under emphasis is marked where it stands', () => {
		expect(markFileRefs('- lease.ts:20 renews\n- *in session/lease.ts*', PATHS)).toBe(
			'- `lease.ts:20` renews\n- *in `session/lease.ts`*'
		);
	});

	test('a name the change does not touch, or that two changed files share, stays text', () => {
		const text = 'token.ts:4 and index.ts:9 and PermissionPrompt.ts:74 and e.g. v1.2.3.';

		expect(markFileRefs(text, PATHS)).toBe(text);
	});

	test('code spans, fenced code, links and web addresses are never touched', () => {
		const text = [
			'Already `lease.ts:20` here, [lease.ts](https://x.dev/lease.ts) there,',
			'and https://x.dev/src/session/lease.ts too.',
			'```ts',
			'import { renew } from "./lease.ts";',
			'```',
			'After the fence lease.ts counts again.'
		].join('\n');

		expect(markFileRefs(text, PATHS)).toBe(text.replace('fence lease.ts', 'fence `lease.ts`'));
	});

	test('a file name inside a longer word or path is not a mention', () => {
		const text = 'Not mylease.ts, lease.tsx or lib/src/session/lease.ts.bak';

		expect(markFileRefs(text, PATHS)).toBe(text);
	});
});

describe('namedFiles', () => {
	test('lists each changed file once per place, from running text and code spans, in order', () => {
		const text = 'In `lease.ts:20` and store/index.ts, then lease.ts:20 again and `lease.ts:31`; not `renew()`.';

		expect(namedFiles(text, PATHS)).toEqual([
			{ path: 'src/session/lease.ts', lines: '20', line: 20 },
			{ path: 'src/store/index.ts', lines: null, line: null },
			{ path: 'src/session/lease.ts', lines: '31', line: 31 }
		]);
	});

	test('a code span that wraps across a line still names its file', () => {
		expect(namedFiles('Opens ` lease.ts:20 `\nthere.', PATHS)).toMatchObject([{ line: 20 }]);
	});

	test('fenced code names nothing', () => {
		expect(namedFiles('```\nlease.ts:20\n```', PATHS)).toEqual([]);
	});
});
