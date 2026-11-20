import type { PullDescription, PullDescriptionState } from '@recoder/shared';

import { SAMPLE_PULL } from './sample-review';
import { sampleTime } from './sample-clock';

/** What a cheap model wrote about the sample pull request (api #214), grouped by what the code does. */
const SAMPLE_DESCRIPTION: PullDescription = {
	headSha: SAMPLE_PULL.headSha,
	model: { id: 'xai/grok-4.6', label: 'Grok 4.6', effort: 'low' },
	summary:
		'Puts a per-tenant rate limit in front of the public API. Each tenant gets a token bucket of 100 requests a minute; a request that finds its bucket empty gets a `429` with `Retry-After`, and every request is counted per minute in Redis for the usage dashboard.',
	groups: [
		{
			id: 'g1',
			title: 'A token bucket per tenant',
			note: 'Buckets of 100 tokens that refill over each minute, kept in memory per tenant.',
			explanation:
				'`Limiter.take` refills a bucket by the seconds since it was last read, then spends one token or refuses. `retryAfter` says how many seconds until the next token. The capacity comes from `config.rateLimit.capacity` in `config.ts`, and buckets live in a `Map` in the process.',
			paths: ['src/rate-limit/limiter.ts', 'src/config.ts']
		},
		{
			id: 'g2',
			title: 'Enforcing it on the public API',
			note: 'Middleware on /api/* that answers 429 with Retry-After when a tenant runs out.',
			explanation:
				'`rateLimit` reads `x-tenant-id`, takes a token from that tenant’s bucket and records the request, then answers `429` with `Retry-After` and a JSON body when none is left. `server.ts` mounts it on `/api/*` after the health checks, so `/health` never counts. A request without the header falls back to one shared `anonymous` bucket.',
			paths: ['src/rate-limit/middleware.ts', 'src/server.ts']
		},
		{
			id: 'g3',
			title: 'Usage counts for the dashboard',
			note: 'Each request adds one to a per-minute counter in Redis.',
			explanation:
				'`UsageStore.record` increments `usage:<tenant>:<minute>` and sets it to expire after two minutes, so the dashboard reads the last minute’s count per tenant. It is called for every request, refused ones included.',
			paths: ['src/rate-limit/store.ts']
		},
		{
			id: 'g4',
			title: 'Tests and docs',
			note: 'Refill, the 429 path and the health bypass are tested, and a page documents the limits for API clients.',
			explanation:
				'`limiter.test.ts` drives the bucket with a fake clock: capacity, refill and tenants kept apart. `middleware.test.ts` spends 100 requests and checks the `429` body and header, and that `/health` is never limited. `rate-limits.md` documents the limit for API clients.',
			paths: ['tests/rate-limit/limiter.test.ts', 'tests/rate-limit/middleware.test.ts', 'docs/rate-limits.md']
		}
	],
	notes: [
		'Buckets live in each process, so with three replicas a tenant can reach 300 requests a minute.',
		'Requests without `x-tenant-id` all share one bucket; the review reports this as a high bug.'
	],
	createdAt: sampleTime('2026-10-13T09:02:00.000Z')
};

/** How long the sample takes to write its description again. */
const REWRITE_MS = 4_000;

/** When the description being written again started; null while none is. */
let rewriting: number | null = null;

function described(repoId: string, number: number): boolean {
	return repoId === 'sample-api' && number === SAMPLE_PULL.number;
}

/** The sample's description of a pull request: written for api #214, and not offered for the others. */
export function sampleDescription(repoId: string, number: number): PullDescriptionState {
	if (!described(repoId, number)) {
		return { status: 'unavailable', reason: 'The sample has a description for api #214 only.' };
	}

	if (rewriting !== null && Date.now() - rewriting < REWRITE_MS) {
		return { status: 'pending', headSha: SAMPLE_PULL.headSha, startedAt: new Date(rewriting).toISOString() };
	}

	return { status: 'ready', description: SAMPLE_DESCRIPTION };
}

/** Writes the sample's description again: it is being written for a few seconds, then the same one returns. */
export function sampleRedescribe(repoId: string, number: number): PullDescriptionState {
	if (described(repoId, number)) rewriting = Date.now();

	return sampleDescription(repoId, number);
}
