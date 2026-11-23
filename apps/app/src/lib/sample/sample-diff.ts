import type { DiffHunk, DiffLine, DiffMove, FileDiff } from '@recoder/shared';

/** A hunk from `+`, `-` and ` ` prefixed lines, numbered from the given starts. */
function hunk(oldStart: number, newStart: number, body: string): DiffHunk {
	let oldNo = oldStart;
	let newNo = newStart;

	const lines = body.split('\n').map((raw): DiffLine => {
		const mark = raw[0];
		const text = raw.slice(1);

		if (mark === '+') return { type: 'add', oldNo: null, newNo: newNo++, text };
		if (mark === '-') return { type: 'del', oldNo: oldNo++, newNo: null, text };

		return { type: 'context', oldNo: oldNo++, newNo: newNo++, text };
	});

	const oldCount = lines.filter((line) => line.type !== 'add').length;
	const newCount = lines.filter((line) => line.type !== 'del').length;

	return {
		header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
		oldStart,
		oldCount,
		newStart,
		newCount,
		lines
	};
}

function file(path: string, ...hunks: DiffHunk[]): FileDiff {
	const lines = hunks.flatMap((h) => h.lines);

	return {
		path,
		additions: lines.filter((line) => line.type === 'add').length,
		deletions: lines.filter((line) => line.type === 'del').length,
		hunks
	};
}

/** A new file: every line added. */
function added(path: string, text: string): FileDiff {
	return file(
		path,
		hunk(
			0,
			1,
			text
				.split('\n')
				.map((line) => `+${line}`)
				.join('\n')
		)
	);
}

const LIMITER = `/** Options for a token bucket per key. */
export interface BucketOptions {
	capacity: number;
	refillPerSecond: number;
	now?: () => number;
}

/** A token bucket per key. Each request spends one token. */
export class Limiter {
	private buckets = new Map<string, { tokens: number; at: number }>();

	constructor(private options: BucketOptions) {}

	private clock(): number {
		return (this.options.now ?? Date.now)();
	}

	/** Spend a token for \`key\`; false when its bucket is empty. */
	take(key: string): boolean {
		const now = this.clock();
		const bucket = this.buckets.get(key) ?? { tokens: this.options.capacity, at: now };
		const elapsed = (now - bucket.at) / 1000;

		bucket.tokens = bucket.tokens + elapsed * this.options.refillPerSecond;
		bucket.at = now;

		if (bucket.tokens < 1) {
			this.buckets.set(key, bucket);

			return false;
		}

		bucket.tokens -= 1;
		this.buckets.set(key, bucket);

		return true;
	}

	/** Seconds until \`key\` has a token again. */
	retryAfter(key: string): number {
		const bucket = this.buckets.get(key);

		if (!bucket || bucket.tokens >= 1) return 0;

		return Math.ceil((1 - bucket.tokens) / this.options.refillPerSecond);
	}
}`;

const MIDDLEWARE = `import type { MiddlewareHandler } from 'hono';
import { config } from '../config';
import { Limiter } from './limiter';
import { UsageStore } from './store';

const limiter = new Limiter({
	capacity: config.rateLimit.capacity,
	refillPerSecond: config.rateLimit.capacity / 60
});

const usage = new UsageStore(config.redisUrl);

/** Rate limits each tenant. Health checks are mounted first and never reach it. */
export const rateLimit: MiddlewareHandler = async (c, next) => {
	const tenant = c.req.header('x-tenant-id') ?? 'anonymous';
	const allowed = limiter.take(tenant);

	await usage.record(tenant);

	if (!allowed) {
		const retryAfter = limiter.retryAfter(tenant);

		c.header('Retry-After', String(retryAfter));

		return c.json({ error: 'rate_limited', retryAfter }, 429);
	}

	await next();
};`;

const STORE = `import { createClient, type RedisClientType } from 'redis';

/** Requests per tenant per minute, for the usage dashboard. */
export class UsageStore {
	private client: RedisClientType;

	constructor(url: string) {
		this.client = createClient({ url });
	}

	async record(tenant: string): Promise<void> {
		const key = \`usage:\${tenant}:\${Math.floor(Date.now() / 60_000)}\`;

		await this.client.incr(key);
		await this.client.expire(key, 120);
	}
}`;

const LIMITER_TEST = `import { describe, expect, test } from 'bun:test';
import { Limiter } from '../../src/rate-limit/limiter';

function limiter(capacity = 3) {
	let now = 0;
	const bucket = new Limiter({ capacity, refillPerSecond: 1, now: () => now });

	return { bucket, tick: (ms: number) => (now += ms) };
}

describe('Limiter', () => {
	test('allows up to capacity, then refuses', () => {
		const { bucket } = limiter();

		expect([1, 2, 3, 4].map(() => bucket.take('a'))).toEqual([true, true, true, false]);
	});

	test('refills one token per second', () => {
		const { bucket, tick } = limiter(1);

		bucket.take('a');
		tick(1000);
		expect(bucket.take('a')).toBe(true);
	});

	test('keeps tenants apart', () => {
		const { bucket } = limiter(1);

		bucket.take('a');
		expect(bucket.take('b')).toBe(true);
	});
});`;

const MIDDLEWARE_TEST = `import { expect, test } from 'bun:test';
import { app } from '../../src/server';

test('answers 429 with Retry-After once a tenant is out of tokens', async () => {
	const hit = () => app.request('/api/projects', { headers: { 'x-tenant-id': 't1' } });

	for (let i = 0; i < 100; i++) await hit();

	const res = await hit();

	expect(res.status).toBe(429);
	expect(res.headers.get('Retry-After')).toBe('1');
	expect(await res.json()).toEqual({ error: 'rate_limited', retryAfter: 1 });
});

test('never limits health checks', async () => {
	for (let i = 0; i < 150; i++) expect((await app.request('/health')).status).toBe(200);
});`;

const DOCS = `# Rate limits

Every tenant gets **100 requests a minute** across \`/api/*\`.
Send your tenant id in the \`x-tenant-id\` header.

When you run out, the API answers \`429\` with a \`Retry-After\`
header and a JSON body:

\`\`\`json
{ "error": "rate_limited", "retryAfter": 1 }
\`\`\`

Health checks (\`/health\`) are never limited.`;

const CLIENT_KEY_BODY = `/** The tenant a request belongs to: its header, else the caller's address. */
export function clientKey(c: Context): string {
\tconst forwarded = c.req.header('x-forwarded-for');

\tif (forwarded) return forwarded.split(',')[0].trim();

\treturn c.env?.remoteAddr ?? 'unknown';
}`;

/** Each line of \`text\` with a diff mark in front. */
function marked(mark: '+' | '-', text: string): string {
	return text
		.split('\n')
		.map((line) => `${mark}${line}`)
		.join('\n');
}

/** `clientKey` moved, unchanged, from the projects route to its own module, for the limiter to share. */
export const CLIENT_KEY_MOVE: DiffMove = {
	fromPath: 'src/routes/projects.ts',
	fromLines: { start: 30, end: 37 },
	toPath: 'src/http/client-key.ts',
	toLines: { start: 3, end: 10 },
	kind: 'moved',
	exact: true,
	match: 'exact'
};

const TOKEN_AREAS = [
	'account',
	'admin',
	'alerts',
	'auth',
	'billing',
	'calendar',
	'charts',
	'chat',
	'checkout',
	'comments',
	'dashboard',
	'editor',
	'files',
	'forms',
	'inbox',
	'invites',
	'layout',
	'media',
	'menus',
	'modals',
	'navigation',
	'notifications',
	'onboarding',
	'profile',
	'projects',
	'reports',
	'search',
	'settings',
	'tables',
	'teams'
];

const TOKEN_PARTS = ['Header', 'Panel', 'List', 'Row', 'Card', 'Empty', 'Toolbar', 'Dialog', 'Badge', 'Footer'];

/** The dark mode tokens pull request, the sample's large one: thirty folders of components, 300 files. */
export const TOKENS_PULL = 93;

/** Each component of the tokens pull request with its hard-coded colours swapped for tokens. */
export const TOKEN_DIFFS: FileDiff[] = TOKEN_AREAS.flatMap((area) =>
	TOKEN_PARTS.map((part, index) =>
		file(
			`src/components/${area}/${part}.tsx`,
			hunk(8 + index, 8 + index, " const style = {\n-\tbackground: '#ffffff',\n+\tbackground: 'var(--bg-panel)',\n };"),
			...(index % 3 === 0
				? [
						hunk(
							30 + index,
							30 + index,
							" <span\n-\tstyle={{ color: '#111111' }}\n+\tstyle={{ color: 'var(--text-primary)' }}\n />"
						)
					]
				: [])
		)
	)
);

/** The files every sample pull request but the main one changes: the start of the main diff. */
export const SMALL_DIFF = 3;

/** The sample pull request's files, in the order a forge lists them. */
export const SAMPLE_DIFFS: FileDiff[] = [
	added('src/rate-limit/limiter.ts', LIMITER),
	added('src/rate-limit/middleware.ts', MIDDLEWARE),
	added('src/rate-limit/store.ts', STORE),
	{
		...added('src/http/client-key.ts', `import type { Context } from 'hono';\n\n${CLIENT_KEY_BODY}`),
		status: 'added',
		moves: [CLIENT_KEY_MOVE]
	},
	file(
		'src/routes/projects.ts',
		hunk(
			26,
			26,
			` import { config } from '../config';
 
 export const projects = new Hono();
 
${marked('-', CLIENT_KEY_BODY)}
-
 projects.get('/', async (c) => {`
		)
	),
	{
		path: 'src/shared/retry.ts',
		oldPath: 'src/util/retry.ts',
		status: 'renamed',
		similarity: 100,
		additions: 0,
		deletions: 0,
		hunks: []
	},
	file(
		'src/server.ts',
		hunk(
			1,
			1,
			` import { Hono } from 'hono';
 import { health } from './routes/health';
 import { projects } from './routes/projects';
+import { rateLimit } from './rate-limit/middleware';`
		),
		hunk(
			4,
			5,
			`
 export const app = new Hono();

 app.route('/health', health);
+app.use('/api/*', rateLimit);
 app.route('/api/projects', projects);

-app.onError((err, c) => c.json({ error: 'internal' }, 500));
+app.onError((err, c) => {
+	console.error(err);
+
+	return c.json({ error: 'internal' }, 500);
+});`
		)
	),
	file(
		'src/config.ts',
		hunk(
			8,
			8,
			` 	port: Number(process.env.PORT ?? 3000),
 	databaseUrl: required('DATABASE_URL'),
+	redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
+	rateLimit: {
+		capacity: Number(process.env.RATE_LIMIT ?? 100),
+		windowMs: 60_000
+	},
 	logLevel: process.env.LOG_LEVEL ?? 'info'
 };`
		)
	),
	added('tests/rate-limit/limiter.test.ts', LIMITER_TEST),
	added('tests/rate-limit/middleware.test.ts', MIDDLEWARE_TEST),
	added('docs/rate-limits.md', DOCS),
	file(
		'bun.lock',
		hunk(
			41,
			41,
			`     "hono": ["hono@4.6.3", "", {}, "sha512-0LeEuBNFeSHGqZ9sNVVgZjB1V5fmhkBSB0hZrpqStSMLOWgfLy0dHOvrjbJh0H2khsjet6rbHfWTHY0kpYThKQ=="],
+
+    "redis": ["redis@4.7.0", "", { "dependencies": { "@redis/client": "1.6.0" } }, "sha512-zvmkHEAdGMn+hMRXuMBtu4Vo5P6rHQjLoHftu+lBqq8ZTA3RCVC/WzD790bkKKiNFp7d5/9PcSD19fJyyRvOdQ=="],
+
+    "@redis/client": ["@redis/client@1.6.0", "", {}, "sha512-aR0uffYI700OEEH4gYnitAnv3vzVGXCFvYfdpu/CJKvk4pHfLPEy/JSZyrpQ+15WhXe1yJRXLtfQ84s4mEXnPg=="],

     "zod": ["zod@3.23.8", "", {}, "sha512-XBx9AXhXktjUqnepgTiE5flcKIYWi/rme0Eaj+5Y0lftuGBq+jyRu/md4WnuxqgP1ubdpNCsYEYPxrzVHD8d6g=="],`
		)
	)
];
