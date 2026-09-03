/**
 * Frontend diff mocks + lookup. Parsing lives in @recoder/shared so the
 * server pipeline uses the same implementation.
 */
import {
	parseUnifiedDiff,
	type DiffHunk,
	type DiffLine,
	type DiffLineType,
	type FileDiff
} from '@recoder/shared';

export type { DiffHunk, DiffLine, DiffLineType, FileDiff };

const MOCK_LIMITER_DIFF = `diff --git a/src/rate-limit/limiter.ts b/src/rate-limit/limiter.ts
--- a/src/rate-limit/limiter.ts
+++ b/src/rate-limit/limiter.ts
@@ -1,12 +1,17 @@
 import type { Clock } from '../time/clock';
 
 export interface Bucket {
   tokens: number;
   last: number;
 }
 
 const CAPACITY = 60;
 const REFILL_PER_SEC = 1;
-const buckets = new Map<string, Bucket>();
+export class RateLimiter {
+  public buckets = new Map<string, Bucket>();
+
+  constructor(
+    private capacity: number = CAPACITY,
+    private refillPerSec: number = REFILL_PER_SEC
+  ) {}
@@ -14,9 +19,15 @@
 /** Consume cost tokens for key. False when drained. */
-export function allow(key: string, cost = 1): boolean {
-  const b = buckets.get(key) ?? { tokens: CAPACITY, last: Date.now() };
+  allow(key: string, cost = 1): boolean {
+    const bucket = this.bucketFor(key);
+    this.refill(bucket);
+    if (bucket.tokens < cost) return false;
+    bucket.tokens -= cost;
+    return true;
+  }
+
+  private bucketFor(key: string): Bucket {
+    let bucket = this.buckets.get(key);
+    if (!bucket) {
+      bucket = { tokens: this.capacity, last: Date.now() };
+      this.buckets.set(key, bucket);
+    }
+    return bucket;
   }
`;

/** Stand-in file diff until the review pipeline produces real ones. */
export const mockLimiterDiff: FileDiff = parseUnifiedDiff(MOCK_LIMITER_DIFF)[0];

const MOCK_INDEX_DIFF = `diff --git a/src/rate-limit/index.ts b/src/rate-limit/index.ts
--- a/src/rate-limit/index.ts
+++ b/src/rate-limit/index.ts
@@ -1,7 +1,9 @@
-export { buckets } from './limiter';
+export { RateLimiter } from './limiter';
 export type { Bucket } from './limiter';
+export { QuotaTracker } from './quota';
 
-export const VERSION = '1.4.0';
+export const VERSION = '2.0.0';
 
 export function createLimiter() {
-  return buckets;
+  return new RateLimiter();
 }`;

const MOCK_QUOTA_DIFF = `diff --git a/src/rate-limit/quota.ts b/src/rate-limit/quota.ts
--- a/src/rate-limit/quota.ts
+++ b/src/rate-limit/quota.ts
@@ -3,6 +3,7 @@
 export class QuotaTracker {
   private used = 0;
+  readonly createdAt = Date.now();
 
   consume(amount: number): boolean {`;

const MOCK_GATEWAY_DIFF = `diff --git a/src/gateway/gateway.ts b/src/gateway/gateway.ts
--- a/src/gateway/gateway.ts
+++ b/src/gateway/gateway.ts
@@ -85,7 +85,7 @@
 function resolveClient(req: Request): string {
-  const ip = req.headers.get('x-forwarded-for')?.split(',')[0];
+  const ip = req.socket.remoteAddress ?? 'unknown';
   return ip.trim();
 }
 
@@ -101,7 +101,7 @@
 export async function handle(req: Request) {
-  const key = namespaced(req);
+  const key = resolveClient(req);
   if (!limiter.allow(key)) return throttled();`;

const MOCK_CLOCK_DIFF = `diff --git a/src/time/clock.ts b/src/time/clock.ts
--- a/src/time/clock.ts
+++ b/src/time/clock.ts
@@ -1,5 +1,11 @@
 export interface Clock {
   now(): number;
 }
+
+export const systemClock: Clock = {
+  now: () => Date.now()
+};
+
+export function fixedClock(at: number): Clock {
+  return { now: () => at };
+}`;

const MOCK_TEST_DIFF = `diff --git a/test/limiter.test.ts b/test/limiter.test.ts
--- a/test/limiter.test.ts
+++ b/test/limiter.test.ts
@@ -1,12 +1,20 @@
-import { allow, buckets } from '../src/rate-limit/limiter';
+import { RateLimiter } from '../src/rate-limit/limiter';
+import { fixedClock } from '../src/time/clock';
 
-describe('allow', () => {
-  it('drains a fresh bucket', () => {
-    expect(allow('a')).toBe(true);
+describe('RateLimiter', () => {
+  it('drains a fresh bucket', () => {
+    const limiter = new RateLimiter();
+    expect(limiter.allow('a')).toBe(true);
   });
 
-  it('rejects when drained', () => {
-    for (let i = 0; i < 60; i++) allow('b');
-    expect(allow('b')).toBe(false);
+  it('rejects when drained', () => {
+    const limiter = new RateLimiter(2);
+    limiter.allow('b');
+    limiter.allow('b');
+    expect(limiter.allow('b')).toBe(false);
   });
+
+  it('refills with the injected clock', () => {
+    const limiter = new RateLimiter(1, 1);
+    expect(limiter.allow('c')).toBe(true);
+  });
 }`;

const FILE_DIFFS: Record<string, string> = {
	'src/rate-limit/limiter.ts': MOCK_LIMITER_DIFF,
	'src/rate-limit/index.ts': MOCK_INDEX_DIFF,
	'src/rate-limit/quota.ts': MOCK_QUOTA_DIFF,
	'src/gateway/gateway.ts': MOCK_GATEWAY_DIFF,
	'src/time/clock.ts': MOCK_CLOCK_DIFF,
	'test/limiter.test.ts': MOCK_TEST_DIFF
};

const emptyDiff = (id: string): FileDiff => ({ path: id, additions: 0, deletions: 0, hunks: [] });

/** Parsed diff for a tree file id. Falls back to an empty diff. */
export function getFileDiff(id: string): FileDiff {
	const source = FILE_DIFFS[id];
	if (!source) return emptyDiff(id);
	return parseUnifiedDiff(source)[0] ?? emptyDiff(id);
}
