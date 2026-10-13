import type {
	BriefQuestion,
	BriefQuestionReport,
	BriefQuestionResult,
	Finding,
	PrCheck,
	PullRequest,
	Review
} from '@recoder/shared';

const AT = '2026-10-13T09:12:00.000Z';

const FINDINGS: Finding[] = [
	{
		id: 'sample-f1',
		title: 'Requests without a tenant header share one bucket',
		file: 'src/rate-limit/middleware.ts',
		line: 15,
		endLine: 15,
		severity: 'error',
		category: 'security',
		kind: 'bug',
		symbol: 'rateLimit',
		message:
			'Every request missing `x-tenant-id` counts against a single `anonymous` bucket. Sign-up and login are unauthenticated, so all clients share 100 requests a minute there, and one script can lock everyone out of signing in.',
		suggestion:
			"Key header-less requests by client address (`c.req.header('x-forwarded-for')` behind the proxy), or answer 400 before they reach the limiter.",
		claim: {
			trigger: 'Any client sends 100 requests without `x-tenant-id` inside a minute.',
			executionPath: [
				{ file: 'src/rate-limit/middleware.ts', line: 15, note: 'falls back to "anonymous"' },
				{ file: 'src/rate-limit/limiter.ts', line: 21, note: 'one bucket for that key' },
				{ file: 'src/rate-limit/middleware.ts', line: 25, note: '429 for every later caller' }
			],
			consequence: 'Every unauthenticated client gets 429 for up to a minute.',
			violatedContract: 'Limits are per tenant (the PR description and docs/rate-limits.md:3).'
		},
		verification: {
			status: 'verified',
			method: 'run',
			outcome: 'reproduced',
			reason: 'A second header-less client was refused after the first one spent the shared bucket.',
			command: 'bun test tests/rate-limit/anonymous.repro.test.ts',
			exitCode: 1,
			evidence: {
				command: 'bun test tests/rate-limit/anonymous.repro.test.ts',
				exitCode: 1,
				expected: 'A second header-less client still gets 200.',
				observed:
					'✗ a second client is not limited by the first\n  expected: 200\n  received: 429\n    at tests/rate-limit/anonymous.repro.test.ts:14:27',
				evidenceId: 'ev-1',
				baseline: { unavailable: 'The middleware is new, so the base branch has nothing to run.' }
			}
		}
	},
	{
		id: 'sample-f2',
		title: 'Refill overshoots capacity after an idle period',
		file: 'src/rate-limit/limiter.ts',
		line: 24,
		endLine: 24,
		severity: 'warning',
		category: 'correctness',
		kind: 'bug',
		symbol: 'Limiter.take',
		message:
			'Refill adds `elapsed × rate` without capping at `capacity`. A tenant idle for an hour comes back with 6,000 tokens and can burst sixty times past its limit.',
		claim: {
			trigger: 'A tenant makes no requests for an hour, then sends a burst.',
			executionPath: [
				{ file: 'src/rate-limit/limiter.ts', line: 22, note: 'elapsed = 3600s' },
				{ file: 'src/rate-limit/limiter.ts', line: 24, note: 'tokens grow to 6,000' }
			],
			consequence: 'The burst passes 6,000 requests before the first 429.',
			violatedContract: 'A bucket never holds more than `capacity` tokens.'
		},
		verification: {
			status: 'verified',
			method: 'run',
			outcome: 'reproduced',
			reason: 'After a simulated hour idle the bucket held 6,000 tokens.',
			command: 'bun test tests/rate-limit/limiter.test.ts -t "idle"',
			exitCode: 1,
			evidence: {
				command: 'bun test tests/rate-limit/limiter.test.ts -t "idle"',
				exitCode: 1,
				expected: 'At most 100 requests pass after an idle hour.',
				observed: '✗ caps tokens at capacity after idle\n  expected: 100\n  received: 6000',
				evidenceId: 'ev-2',
				baseline: { unavailable: 'The limiter is new, so the base branch has nothing to run.' }
			}
		},
		patch: {
			diff: `--- a/src/rate-limit/limiter.ts
+++ b/src/rate-limit/limiter.ts
@@ -22,5 +22,8 @@
 		const elapsed = (now - bucket.at) / 1000;

-		bucket.tokens = bucket.tokens + elapsed * this.options.refillPerSecond;
+		bucket.tokens = Math.min(
+			this.options.capacity,
+			bucket.tokens + elapsed * this.options.refillPerSecond
+		);
 		bucket.at = now;`,
			checks: ['bun run check', 'bun test tests/rate-limit']
		}
	},
	{
		id: 'sample-f3',
		title: 'Refill rate ignores the configured window',
		file: 'src/rate-limit/middleware.ts',
		line: 8,
		endLine: 8,
		severity: 'info',
		category: 'convention',
		kind: 'quality',
		smell: 'magic-value',
		symbol: 'limiter',
		message:
			'The PR adds `config.rateLimit.windowMs`, but the middleware divides by a hard-coded `60`. Changing the window in config would silently do nothing.',
		verification: {
			status: 'verified',
			method: 'convention',
			reason: 'Every other limit in config.ts is read where it is used.'
		},
		patch: {
			diff: `--- a/src/rate-limit/middleware.ts
+++ b/src/rate-limit/middleware.ts
@@ -6,4 +6,4 @@
 const limiter = new Limiter({
 	capacity: config.rateLimit.capacity,
-	refillPerSecond: config.rateLimit.capacity / 60
+	refillPerSecond: config.rateLimit.capacity / (config.rateLimit.windowMs / 1000)
 });`,
			checks: ['bun run check', 'bun test tests/rate-limit']
		}
	}
];

type Asked = BriefQuestion & { result: BriefQuestionResult; reason: string };

function settled(
	id: string,
	question: string,
	source: BriefQuestion['source'],
	reason: string,
	attempt: { input: string; command: string | null; observed: string } | null,
	contract: { kind: 'source' | 'test' | 'doc'; location: string; note: string }[] = []
): Asked {
	return {
		id,
		question,
		owners: ['correctness'],
		source,
		result: 'disproved',
		reason,
		followUps: [],
		answers: [
			{
				owner: 'correctness',
				candidateIds: [],
				result: 'disproved',
				reason,
				evidenceIds: [],
				contractEvidence: contract,
				attemptedCounterexample: attempt && { ...attempt, evidenceId: null }
			}
		]
	};
}

const QUESTIONS: Asked[] = [
	{
		id: 'Q1',
		question: 'If the process dies between INCR and EXPIRE, is the usage key left without a TTL?',
		owners: ['data-persistence'],
		source: { file: 'src/rate-limit/store.ts', line: 14, symbol: 'UsageStore.record', range: { start: 14, end: 15 } },
		result: 'unresolved',
		reason:
			'The sandbox had no Redis server, so no reviewer could run it. The two commands are sent separately, not in MULTI or as one SET with EX, so a crash between them would leave a key that never expires.',
		answers: [],
		followUps: [{ unitId: null, notRun: 'No Redis in the sandbox.' }]
	},
	settled(
		'Q2',
		'Can concurrent requests overdraw one bucket?',
		{ file: 'src/rate-limit/limiter.ts', line: 19, symbol: 'Limiter.take' },
		'`take` is synchronous: it reads, updates and writes the bucket with no await in between, so the event loop cannot interleave two calls.',
		{
			input: "500 concurrent take('t1') with capacity 100",
			command: 'bun test tests/rate-limit/concurrency.probe.test.ts',
			observed: '✓ 100 allowed, 400 refused (3ms)'
		},
		[{ kind: 'source', location: 'src/rate-limit/limiter.ts:19-37', note: 'No await between read and write.' }]
	),
	settled(
		'Q3',
		'Is a tenant refused at exactly the limit, or one request later?',
		{ file: 'src/rate-limit/limiter.ts', line: 27, symbol: 'Limiter.take' },
		'The 101st request in a window is the first refused: the `tokens < 1` check runs after refill and before spending.',
		{
			input: 'capacity 3, four requests at t=0',
			command: 'bun test tests/rate-limit/limiter.test.ts -t "allows up to capacity"',
			observed: '✓ allows up to capacity, then refuses (0.4ms)'
		}
	),
	settled(
		'Q4',
		'Do health checks bypass the limiter?',
		{ file: 'src/server.ts', line: 9 },
		'`/health` is mounted before `app.use("/api/*")`, and that pattern does not match it.',
		{
			input: '150 requests to /health',
			command: 'bun test tests/rate-limit/middleware.test.ts -t "health"',
			observed: '✓ never limits health checks (31ms)'
		}
	),
	settled(
		'Q5',
		'Does the 429 body keep the `{ error }` shape existing clients parse?',
		{ file: 'src/rate-limit/middleware.ts', line: 25, symbol: 'rateLimit' },
		'Clients read `error` as a string. The new body keeps `error` and only adds `retryAfter`.',
		null,
		[{ kind: 'source', location: 'sdk/src/errors.ts:22', note: 'Reads `body.error` and nothing else.' }]
	),
	settled(
		'Q6',
		'Does the new error handler still keep internals out of responses?',
		{ file: 'src/server.ts', line: 12 },
		'It logs the error server-side and still answers `{ error: "internal" }` with 500; no message or stack reaches the client.',
		{
			input: 'a route that throws',
			command: 'bun test tests/server.test.ts -t "hides"',
			observed: '✓ hides internal errors (2ms)'
		}
	)
];

const REPORT: BriefQuestionReport = {
	counts: {
		asked: 6,
		confirmed: 0,
		disproved: 5,
		unresolved: 1,
		notApplicable: 0,
		followUpsRun: 0,
		followUpsNotRun: 1
	},
	questions: QUESTIONS
};

/** A finished review of an agent-written PR: three findings, one open question, five things checked. */
export const SAMPLE_REVIEW: Review = {
	id: 'sample',
	repoId: 'sample-repo',
	prNumber: 214,
	headSha: 'a41c9e2f6d0b',
	status: 'passed',
	summary:
		'Adds per-tenant rate limiting to the public API: a token bucket of 100 requests a minute for each tenant, a `429` with `Retry-After` when it runs out, and per-minute usage counts in Redis. Health checks stay unlimited.',
	findings: FINDINGS,
	questions: REPORT,
	runs: [],
	source: 'github',
	prTitle: 'Add per-tenant rate limiting to the public API',
	prUrl: 'https://github.com/acme/api/pull/214',
	startedAt: '2026-10-13T09:08:10.000Z',
	createdAt: '2026-10-13T09:08:00.000Z',
	updatedAt: AT
};

export const SAMPLE_PULL: PullRequest = {
	number: 214,
	title: 'Add per-tenant rate limiting to the public API',
	url: 'https://github.com/acme/api/pull/214',
	author: 'claude[bot]',
	base: 'main',
	headRef: 'agent/rate-limit-tenants',
	headSha: 'a41c9e2f6d0b',
	additions: 172,
	deletions: 1,
	changedFiles: 9,
	createdAt: '2026-10-13T08:51:00.000Z'
};

/** CI on the sample's head commit: green, with end-to-end tests still running. */
export const SAMPLE_CHECKS: PrCheck[] = [
	{ name: 'typecheck', state: 'passed', url: null },
	{ name: 'lint', state: 'passed', url: null },
	{ name: 'unit tests', state: 'passed', url: null },
	{ name: 'e2e', state: 'running', url: null }
];
