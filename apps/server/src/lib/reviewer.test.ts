import { afterEach, describe, expect, test } from 'bun:test';
import { emitReviewEvent, listenerCount, subscribeReview } from './events';
import { extractFindingsJson, runRoleReview } from './harness';
import { configForRole, isReviewConfigured, REVIEW_ROLES } from './models';

const ENV_KEYS = [
	'RECODER_REVIEW_BASE_URL',
	'RECODER_REVIEW_API_KEY',
	'RECODER_REVIEW_MODEL',
	'RECODER_SECURITY_MODEL',
	'RECODER_PERF_MODEL'
];

const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe('models', () => {
	test('unconfigured without env', () => {
		for (const k of ENV_KEYS) delete process.env[k];
		expect(isReviewConfigured()).toBe(false);
		expect(() => configForRole('security')).toThrow();
	});

	test('shared model with per-role override', () => {
		process.env.RECODER_REVIEW_BASE_URL = 'https://example.com/v1/';
		process.env.RECODER_REVIEW_API_KEY = 'key';
		process.env.RECODER_REVIEW_MODEL = 'shared-model';
		process.env.RECODER_SECURITY_MODEL = 'strong-model';
		expect(isReviewConfigured()).toBe(true);
		expect(configForRole('security')).toMatchObject({
			baseUrl: 'https://example.com/v1',
			model: 'strong-model'
		});
		expect(configForRole('perf').model).toBe('shared-model');
		expect(REVIEW_ROLES).toEqual(['security', 'perf', 'correctness', 'docs']);
	});
});

describe('extractFindingsJson', () => {
	test('parses bare arrays', () => {
		expect(extractFindingsJson('[]')).toEqual([]);
	});

	test('tolerates fences and prose', () => {
		const out = 'Here you go:\n```json\n[{"file":"a.ts"}]\n```';
		expect(extractFindingsJson(out)).toEqual([{ file: 'a.ts' }]);
	});

	test('throws without an array', () => {
		expect(() => extractFindingsJson('no json here')).toThrow();
	});
});

describe('runRoleReview', () => {
	const realFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	function stubFetch(output: string, status = 200): void {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({ choices: [{ message: { content: output } }] }),
				{ status, headers: { 'content-type': 'application/json' } }
			)) as unknown as typeof fetch;
	}

	const DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,4 @@
 ctx
-old
+new
 tail`;

	test('maps model output to findings and fires lifecycle callbacks', async () => {
		process.env.RECODER_REVIEW_BASE_URL = 'http://localhost:9/v1';
		process.env.RECODER_REVIEW_API_KEY = 'test';
		process.env.RECODER_REVIEW_MODEL = 'test-model';
		stubFetch(
			JSON.stringify([
				{ file: 'a.ts', line: 2, endLine: 3, severity: 'high', category: 'sec', body: 'bad' },
				{ file: 'other.ts', line: 1, severity: 'low', category: 'x', body: 'not in diff' }
			])
		);
		const started: string[] = [];
		const done: [string, number][] = [];
		const result = await runRoleReview(
			'security',
			{ diff: DIFF, sandboxPath: null },
			{
				onLog: () => {},
				onAgentStart: (r) => started.push(r),
				onAgentDone: (r, n) => done.push([r, n])
			}
		);
		expect(started).toEqual(['security']);
		expect(done).toEqual([['security', 1]]);
		expect(result.findings).toHaveLength(1);
		expect(result.findings[0]).toMatchObject({
			file: 'a.ts',
			line: 2,
			endLine: 3,
			severity: 'error'
		});
	});

	test('bad model output yields no findings but still completes', async () => {
		process.env.RECODER_REVIEW_BASE_URL = 'http://localhost:9/v1';
		process.env.RECODER_REVIEW_API_KEY = 'test';
		process.env.RECODER_REVIEW_MODEL = 'test-model';
		stubFetch('not json at all');
		const done: [string, number][] = [];
		const result = await runRoleReview(
			'perf',
			{ diff: DIFF, sandboxPath: null },
			{ onAgentDone: (r, n) => done.push([r, n]) }
		);
		expect(result.findings).toEqual([]);
		expect(done).toEqual([['perf', 0]]);
	});
});

describe('events', () => {	test('subscribe/emit/unsubscribe', () => {
		const seen: string[] = [];
		const off = subscribeReview('r1', (e) => seen.push(e.message));
		expect(listenerCount('r1')).toBe(1);
		emitReviewEvent('r1', { type: 'log', message: 'hello' });
		expect(seen).toEqual(['hello']);
		off();
		expect(listenerCount('r1')).toBe(0);
		emitReviewEvent('r1', { type: 'log', message: 'after' });
		expect(seen).toEqual(['hello']);
	});

	test('listener failures do not break emit', () => {
		const off = subscribeReview('r2', () => {
			throw new Error('boom');
		});
		expect(() => emitReviewEvent('r2', { type: 'log', message: 'x' })).not.toThrow();
		off();
	});
});
