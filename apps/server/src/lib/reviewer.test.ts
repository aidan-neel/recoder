import { afterEach, describe, expect, test } from 'bun:test';
import {
	clearReviewEvents,
	emitReviewEvent,
	reviewEventBuffer,
	subscribeReview
} from './events';
import { extractFindingsJson, filterNewFindings, fingerprintFinding } from './harness';
import { configForRole, isReviewConfigured } from './models';

const ENV_KEYS = [
	'RECODER_REVIEW_BASE_URL',
	'RECODER_REVIEW_API_KEY',
	'RECODER_REVIEW_MODEL',
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
});

describe('extractFindingsJson', () => {
	test('parses bare arrays', () => {
		expect(extractFindingsJson('[]')).toEqual([]);
	});

	test('unwraps {findings: [...]} objects from json_object mode', () => {
		expect(extractFindingsJson('{"findings":[{"file":"a.ts"}]}')).toEqual([{ file: 'a.ts' }]);
	});

	test('wraps a single finding object', () => {
		expect(extractFindingsJson('{"file":"a.ts","line":1}')).toEqual([{ file: 'a.ts', line: 1 }]);
	});

	test('tolerates fences and prose', () => {
		const out = 'Here you go:\n```json\n[{"file":"a.ts"}]\n```';
		expect(extractFindingsJson(out)).toEqual([{ file: 'a.ts' }]);
	});

	test('throws without an array', () => {
		expect(() => extractFindingsJson('no json here')).toThrow();
	});
});

describe('finding stability', () => {
	test('same issue twice → same fingerprint (wording/whitespace independent)', () => {
		const a = fingerprintFinding('a.ts', 'sec', 'const  buckets  =  new Map();\n');
		const b = fingerprintFinding('a.ts', 'sec', 'const buckets = new Map();');
		expect(a).toBe(b);
	});

	test('different file, category, or code → different fingerprint', () => {
		const base = fingerprintFinding('a.ts', 'sec', 'x = 1;');
		expect(fingerprintFinding('b.ts', 'sec', 'x = 1;')).not.toBe(base);
		expect(fingerprintFinding('a.ts', 'perf', 'x = 1;')).not.toBe(base);
		expect(fingerprintFinding('a.ts', 'sec', 'x = 2;')).not.toBe(base);
	});

	test('filterNewFindings suppresses repeats and in-run duplicates', () => {
		const mk = (id: string, fingerprint?: string) => ({
			id,
			file: 'a.ts',
			line: 1,
			severity: 'info' as const,
			message: id,
			fingerprint
		});
		const current = [
			mk('old', 'fp-old'),
			mk('new', 'fp-new'),
			mk('dup-a', 'fp-dup'),
			mk('dup-b', 'fp-dup'),
			mk('nofp')
		];
		const { fresh, suppressed } = filterNewFindings(current, new Set(['fp-old']));
		expect(fresh.map((f) => f.id)).toEqual(['new', 'dup-a']);
		expect(suppressed).toBe(3);
	});
});

describe('events', () => {
	afterEach(() => {
		clearReviewEvents('r1');
		clearReviewEvents('r2');
		clearReviewEvents('r3');
	});

	test('listener failures do not break emit', () => {
		const off = subscribeReview('r2', () => {
			throw new Error('boom');
		});
		expect(() => emitReviewEvent('r2', { type: 'log', message: 'x' })).not.toThrow();
		off();
		clearReviewEvents('r2');
	});

	test('replays buffered events to late subscribers', () => {
		emitReviewEvent('r3', { type: 'log', step: 'agent:security', message: 'hello' });
		emitReviewEvent('r3', { type: 'finding', message: 'one', data: { items: [{ id: 'f1' }] } });
		expect(reviewEventBuffer('r3').map((e) => e.message)).toEqual(['hello', 'one']);
		const seen: string[] = [];
		const off = subscribeReview('r3', (e) => seen.push(e.message));
		expect(seen).toEqual(['hello', 'one']);
		emitReviewEvent('r3', { type: 'log', message: 'live' });
		expect(seen).toEqual(['hello', 'one', 'live']);
		off();
		clearReviewEvents('r3');
	});
});
