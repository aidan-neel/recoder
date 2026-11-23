import type { DiffGuide, DiffGuideHunk } from '@recoder/shared';

import { hunkId } from '../changes/chapters';
import { SAMPLE_DIFFS } from './sample-diff';

/** The guide's entry for a hunk of the sample diff, by its file and its place in that file. */
function at(path: string, index = 0, more: Omit<DiffGuideHunk, 'id' | 'file'> = {}): DiffGuideHunk {
	const file = SAMPLE_DIFFS.find((candidate) => candidate.path === path);
	const hunk = file?.hunks[index];

	if (!hunk) throw new Error(`The sample diff has no hunk ${index} in ${path}.`);

	return { id: hunkId(path, hunk), file: path, ...more };
}

const MOVED_CLIENT_KEY = { note: 'moved from src/routes/projects.ts' };

const RETRY_RENAME: DiffGuideHunk = {
	id: 'src/shared/retry.ts:renamed-file',
	file: 'src/shared/retry.ts',
	note: 'moved from src/util/retry.ts'
};

/** The reading order the review lays down at once, from the diff's structure alone: files joined by imports and names. */
export const SAMPLE_SEED_GUIDE: DiffGuide = {
	source: 'deterministic',
	groups: [
		{
			id: 'seed-1',
			title: 'src/config.ts, src/rate-limit/limiter.ts',
			hunks: [at('src/config.ts'), at('src/rate-limit/limiter.ts'), at('tests/rate-limit/limiter.test.ts')]
		},
		{
			id: 'seed-2',
			title: 'src/rate-limit/middleware.ts',
			hunks: [
				at('src/rate-limit/middleware.ts'),
				at('src/server.ts', 0),
				at('src/server.ts', 1),
				at('src/http/client-key.ts'),
				at('src/routes/projects.ts', 0, MOVED_CLIENT_KEY),
				at('tests/rate-limit/middleware.test.ts')
			]
		},
		{ id: 'seed-3', title: 'src/rate-limit/store.ts', hunks: [at('src/rate-limit/store.ts')] },
		{ id: 'seed-4', title: 'src/shared/retry.ts', hunks: [RETRY_RENAME] },
		{ id: 'seed-5', title: 'docs/rate-limits.md, bun.lock', hunks: [at('docs/rate-limits.md'), at('bun.lock')] }
	]
};

/** The guide once the model refined the seed: chapters with a why, and a sentence for each hunk. */
export const SAMPLE_GUIDE: DiffGuide = {
	source: 'model',
	groups: [
		{
			id: 'bucket',
			title: 'A token bucket per tenant',
			explanation:
				'Each tenant gets a bucket of 100 tokens that refills over a minute. Read the bucket first, then where its size comes from.',
			hunks: [
				at('src/rate-limit/limiter.ts', 0, {
					explanation:
						'Limiter.take refills a bucket by the seconds since it was last read, then spends one token or refuses.'
				}),
				at('src/config.ts', 0, {
					explanation: 'The bucket’s size and window come from RATE_LIMIT: 100 a minute unless it is set.'
				})
			]
		},
		{
			id: 'enforce',
			title: 'Enforcing it on the public API',
			explanation:
				'Middleware on /api/* answers 429 with Retry-After when a tenant runs out. A request without a tenant falls back to the caller’s address.',
			hunks: [
				at('src/rate-limit/middleware.ts', 0, {
					explanation: 'Takes a token for the request’s tenant and answers 429 with Retry-After when there is none.'
				}),
				at('src/http/client-key.ts', 0, {
					explanation: 'The key for a request with no tenant header: the first forwarded address, else the socket’s.'
				}),
				at('src/routes/projects.ts', 0, { ...MOVED_CLIENT_KEY, explanation: 'clientKey leaves the projects route.' }),
				at('src/server.ts', 1, {
					explanation:
						'Mounts the limiter on /api/* only, so health checks are never limited, and logs unexpected errors.'
				})
			]
		},
		{
			id: 'usage',
			title: 'Usage counts for the dashboard',
			explanation: 'Each request adds one to a per-minute counter in Redis.',
			hunks: [
				at('src/rate-limit/store.ts', 0, {
					explanation: 'Counts a tenant’s requests per minute in Redis, and each count expires two minutes later.'
				})
			]
		},
		{
			id: 'wiring',
			title: 'Wiring',
			explanation: 'The import the API needs for chapter 02, and a helper that moved without a change.',
			hunks: [
				at('src/server.ts', 0, { explanation: 'Imports the middleware the API mounts in chapter 02.' }),
				RETRY_RENAME
			]
		},
		{
			id: 'tests',
			title: 'Tests and docs',
			explanation:
				'Refill, the 429 path and the health bypass are tested, and a page documents the limits for API clients.',
			hunks: [
				at('tests/rate-limit/limiter.test.ts', 0, {
					explanation: 'Refill over time and refusal at zero, on a fake clock.'
				}),
				at('tests/rate-limit/middleware.test.ts', 0, {
					explanation: 'The 429 answer with Retry-After, and /health passing however many requests come.'
				}),
				at('docs/rate-limits.md', 0, { explanation: 'What API clients see when they run out.' }),
				at('bun.lock', 0, { explanation: 'The Redis client the usage store needs.' })
			]
		}
	]
};
