import { describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GhError } from './gh';
import { fetchMergeRequest } from './glab';

const VIEW_JSON =
	'{"iid":5,"title":"Fix MR","web_url":"https://gitlab.com/a/b/-/merge_requests/5",' +
	'"author":{"username":"u"},"target_branch":"main","source_branch":"feat","sha":"def456"}';

const DIFF = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new';

/** PATH shim dir with a fake `glab`. Passed explicitly — Bun ignores process.env PATH mutation. */
async function fakeBin(script: string): Promise<{ env: Record<string, string> }> {
	const dir = await mkdtemp(join(tmpdir(), 'fakebin-'));
	await writeFile(join(dir, 'glab'), script);
	await chmod(join(dir, 'glab'), 0o755);
	return { env: { PATH: `${dir}:${process.env.PATH ?? ''}` } };
}

describe('fetchMergeRequest', () => {
	test('returns metadata + diff via glab', async () => {
		const opts = await fakeBin(
			`#!/bin/sh\nif [ "$1" = "mr" ] && [ "$2" = "view" ]; then echo '${VIEW_JSON}'; exit 0; fi\n` +
				`if [ "$1" = "mr" ] && [ "$2" = "diff" ]; then printf '%s\\n' '${DIFF}'; exit 0; fi\n` +
				`echo 'unexpected' >&2; exit 1\n`
		);
		const { pr, diff } = await fetchMergeRequest('https://gitlab.com/a/b', 5, opts);
		expect(pr.number).toBe(5);
		expect(pr.title).toBe('Fix MR');
		expect(pr.author).toBe('u');
		expect(pr.headSha).toBe('def456');
		expect(pr.base).toBe('main');
		expect(diff).toContain('diff --git');
	});

	test('classifies auth failures', async () => {
		const opts = await fakeBin(`#!/bin/sh\necho '401 Unauthorized' >&2\nexit 1\n`);
		const err = await fetchMergeRequest('https://gitlab.com/a/b', 5, opts).catch((e) => e);
		expect(err).toBeInstanceOf(GhError);
		expect((err as GhError).kind).toBe('auth');
	});
});
