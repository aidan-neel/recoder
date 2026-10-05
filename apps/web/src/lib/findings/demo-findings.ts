import type { Finding } from './finding-model';

const FILE = 'src/rate-limit/limiter.ts';

const PRIVATE_BUCKETS_PATCH = `diff --git a/src/rate-limit/limiter.ts b/src/rate-limit/limiter.ts
--- a/src/rate-limit/limiter.ts
+++ b/src/rate-limit/limiter.ts
@@ -10,3 +10,3 @@
 export class RateLimiter {
-  public buckets = new Map<string, Bucket>();
+  private buckets = new Map<string, Bucket>();

`;

const DEAD_FACTORY_PATCH = `diff --git a/src/rate-limit/index.ts b/src/rate-limit/index.ts
--- a/src/rate-limit/index.ts
+++ b/src/rate-limit/index.ts
@@ -5,5 +5,1 @@
 export const VERSION = '2.0.0';
-
-export function createLimiter() {
-  return new RateLimiter();
-}
`;

/** Findings for sessions without a backend review, so the findings view has something to show. */
export function demoFindings(): Finding[] {
	return [
		{
			id: 'f-security-tenant',
			code: 'F-01',
			title: 'Shared buckets leak limits across tenants',
			severity: 'high',
			category: 'security',
			kind: 'bug',
			symbol: 'RateLimiter.bucketFor',
			agent: 'security',
			body: "bucketFor shares one Map across tenants — two tenants behind one egress IP drain each other's budget.",
			file: FILE,
			startLine: 28,
			endLine: 31,
			verification: {
				status: 'verified',
				reason: 'A repro that takes 10 requests as tenant A leaves tenant B with 0 tokens.',
				command: 'bun test src/rate-limit/recoder-repro.test.ts',
				exitCode: 1
			},
			status: 'open'
		},
		{
			id: 'f-perf-eviction',
			code: 'F-02',
			title: 'Unbounded bucket storage',
			severity: 'medium',
			category: 'performance',
			kind: 'bug',
			agent: 'performance',
			body: 'buckets Map has no eviction, so it grows once per key forever',
			verification: {
				status: 'verified',
				method: 'trace',
				reason: 'bucketFor adds a key per caller and nothing in limiter.ts deletes one.'
			},
			file: FILE,
			startLine: 10,
			endLine: 12,
			status: 'open'
		},
		{
			id: 'f-correctness-clock',
			code: 'F-03',
			title: 'Refill ignores the injected clock',
			severity: 'medium',
			category: 'correctness',
			kind: 'bug',
			agent: 'correctness',
			body: 'refill() reads Date.now() directly, so the injected Clock is dead weight and tests cannot control time.',
			verification: {
				status: 'verified',
				method: 'trace',
				reason: 'refill() calls Date.now() and never this.clock.now().'
			},
			file: FILE,
			startLine: 20,
			endLine: 23,
			status: 'open'
		},
		{
			id: 'f-docs-allow',
			code: 'F-04',
			title: 'Outdated allow documentation',
			severity: 'low',
			category: 'readability',
			kind: 'quality',
			smell: 'stale-comment',
			agent: 'readability',
			body: '`allow` moved into the class but the doc comment still reads like a free function.',
			verification: {
				status: 'verified',
				method: 'trace',
				reason: 'The comment above allow() still describes a free function.'
			},
			file: FILE,
			startLine: 19,
			endLine: 19,
			status: 'open'
		},
		{
			id: 'f-style-capacity',
			code: 'F-05',
			title: 'Zero capacity silently blocks requests',
			severity: 'low',
			category: 'error-handling',
			kind: 'bug',
			agent: 'correctness',
			body: 'Constructor takes capacity but never validates it — zero capacity bricks every bucket silently.',
			verification: {
				status: 'verified',
				method: 'trace',
				reason: 'With capacity 0, allow() finds 0 tokens on the first call and returns false.'
			},
			file: FILE,
			startLine: 13,
			endLine: 16,
			status: 'open'
		},
		{
			id: 'q-rule-buckets',
			code: 'F-06',
			title: 'Bucket map is public',
			severity: 'low',
			category: 'repo-rule',
			kind: 'quality',
			ruleId: 'R3',
			symbol: 'RateLimiter.buckets',
			agent: 'quality',
			body: '`buckets` is public, but nothing outside `RateLimiter` reads it. R3 keeps class state private unless a caller needs it.',
			file: FILE,
			startLine: 11,
			endLine: 11,
			verification: {
				status: 'verified',
				method: 'rule',
				reason: 'R3 in AGENTS.md, and no reference to `.buckets` outside limiter.ts.'
			},
			patch: { diff: PRIVATE_BUCKETS_PATCH, checks: ['bun run check', 'bun run lint'] },
			status: 'open'
		},
		{
			id: 'q-dead-factory',
			code: 'F-07',
			title: 'createLimiter has no callers',
			severity: 'low',
			category: 'dead-code',
			kind: 'quality',
			symbol: 'createLimiter',
			agent: 'quality',
			body: 'Every caller now builds a `RateLimiter` directly, so `createLimiter` is unused.',
			file: 'src/rate-limit/index.ts',
			startLine: 7,
			endLine: 9,
			verification: {
				status: 'verified',
				method: 'detector',
				reason: 'knip reports createLimiter as an unused export.'
			},
			patch: { diff: DEAD_FACTORY_PATCH, checks: ['bun run check', 'bun run lint', 'bun run deadcode'] },
			status: 'open'
		},
		{
			id: 'q-readability-bucket-for',
			code: 'F-08',
			title: 'bucketFor writes while it reads',
			severity: 'low',
			category: 'readability',
			kind: 'quality',
			smell: 'hidden-side-effect',
			symbol: 'RateLimiter.bucketFor',
			agent: 'quality',
			body: '`bucketFor` reads like a lookup but also inserts a new bucket. A name like `getOrCreateBucket` says so.',
			file: FILE,
			startLine: 28,
			endLine: 34,
			verification: {
				status: 'verified',
				method: 'convention',
				reason: '`getOrCreateQuota` and `getOrCreateSlot` name the same pattern in this repo.'
			},
			status: 'open'
		}
	];
}
