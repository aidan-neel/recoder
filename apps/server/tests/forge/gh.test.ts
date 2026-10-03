import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchPullRequest, GhError, listPullRequests, parseRepoSlug } from '../../src/forge/gh';
import { extractJson } from '../../src/forge/gh';
import { fakeBin } from '../helpers/fake-bin';

const VIEW_JSON =
	'{"number":7,"title":"Fix it","url":"https://github.com/o/r/pull/7",' +
	'"author":{"login":"octo"},"baseRefName":"main","headRefName":"feat",' +
	'"headRefOid":"abc123","additions":10,"deletions":2,"changedFiles":3,' +
	'"createdAt":"2026-08-30T12:00:00Z"}';

const DIFF = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new';

describe('parseRepoSlug', () => {
	test('parses https, ssh, and bare slugs', () => {
		expect(parseRepoSlug('https://github.com/o/r')).toBe('o/r');
		expect(parseRepoSlug('https://github.com/o/r.git')).toBe('o/r');
		expect(parseRepoSlug('git@github.com:o/r.git')).toBe('o/r');
		expect(parseRepoSlug('o/r')).toBe('o/r');
	});

	test('rejects garbage', () => {
		expect(() => parseRepoSlug('not a url')).toThrow(GhError);
	});
});

describe('fetchPullRequest', () => {
	test('metadata-only reviews never request the size-limited diff', async () => {
		const opts = await fakeBin(
			'gh',
			`#!/bin/sh\nif [ "$1" = "pr" ] && [ "$2" = "view" ]; then echo '${VIEW_JSON}'; exit 0; fi\necho 'HTTP 406: diff too large' >&2; exit 1\n`
		);

		const { pr, diff } = await fetchPullRequest('o/r', 7, { ...opts, metadataOnly: true });

		expect(pr.number).toBe(7);
		expect(diff).toBe('');
	});

	test('returns metadata + diff via gh', async () => {
		const opts = await fakeBin(
			'gh',
			`#!/bin/sh\nif [ "$1" = "pr" ] && [ "$2" = "view" ]; then echo '${VIEW_JSON}'; exit 0; fi\n` +
				`if [ "$1" = "pr" ] && [ "$2" = "diff" ]; then printf '%s\\n' '${DIFF}'; exit 0; fi\n` +
				`echo 'unexpected' >&2; exit 1\n`
		);

		const { pr, diff } = await fetchPullRequest('https://github.com/o/r', 7, opts);

		expect(pr.title).toBe('Fix it');
		expect(pr.author).toBe('octo');
		expect(pr.headSha).toBe('abc123');
		expect(pr.additions).toBe(10);
		expect(pr.createdAt).toBe('2026-08-30T12:00:00Z');
		expect(diff).toContain('diff --git');
	});

	test('classifies missing PRs as not-found', async () => {
		const opts = await fakeBin('gh', `#!/bin/sh\necho 'no pull requests found' >&2\nexit 1\n`);
		const err = await fetchPullRequest('o/r', 9, opts).catch((e) => e);

		expect(err).toBeInstanceOf(GhError);
		expect((err as GhError).kind).toBe('not-found');
	});

	test('missing binary is unavailable', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'emptybin-'));
		const err = await fetchPullRequest('o/r', 9, { env: { PATH: dir } }).catch((e) => e);

		expect(err).toBeInstanceOf(GhError);
		expect((err as GhError).kind).toBe('unavailable');
	});
});

describe('listPullRequests', () => {
	const LIST_JSON =
		'[{"number":7,"title":"Fix it","url":"https://github.com/o/r/pull/7",' +
		'"author":{"login":"octo"},"baseRefName":"main","headRefName":"feat",' +
		'"headRefOid":"abc123","additions":10,"deletions":2,"changedFiles":3,' +
		'"createdAt":"2026-08-30T12:00:00Z"},' +
		'{"number":6,"title":"Docs","url":"https://github.com/o/r/pull/6",' +
		'"author":{"login":"sam"},"baseRefName":"main","headRefName":"docs",' +
		'"headRefOid":"def456","additions":1,"deletions":0,"changedFiles":1,' +
		'"createdAt":"2026-08-29T09:00:00Z"}]';

	test('returns open PRs via gh pr list', async () => {
		const opts = await fakeBin('gh', `#!/bin/sh\necho '${LIST_JSON}'; exit 0\n`);
		const prs = await listPullRequests('https://github.com/o/r', opts);

		expect(prs).toHaveLength(2);
		expect(prs[0].number).toBe(7);
		expect(prs[0].author).toBe('octo');
		expect(prs[0].createdAt).toBe('2026-08-30T12:00:00Z');
		expect(prs[1].number).toBe(6);
		expect(prs[1].additions).toBe(1);
	});

	test('rejects non-array output', async () => {
		const opts = await fakeBin('gh', `#!/bin/sh\necho '{"number":7}'; exit 0\n`);
		const err = await listPullRequests('o/r', opts).catch((e) => e);

		expect(err).toBeInstanceOf(GhError);
	});
});

describe('extractJson', () => {
	test('parses top-level arrays (gh repo list)', () => {
		expect(extractJson('[{"a":1}]')).toEqual([{ a: 1 }]);
		expect(extractJson('noise\n[{"a":1}]\n')).toEqual([{ a: 1 }]);
	});
});
