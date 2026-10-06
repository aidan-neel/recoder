import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun } from '../../../../src/review/pipeline/harness/context';
import { briefBlock } from '../../../../src/review/pipeline/intent/brief';
import { distillIntent } from '../../../../src/review/pipeline/intent/distill';
import { intentBlock } from '../../../../src/review/pipeline/intent/format';
import type { IntentSource } from '../../../../src/review/pipeline/intent/types';
import { partitionUnits } from '../../../../src/review/pipeline/units';
import { reviewNow } from '../../../../src/review/session/review-control';
import { REVIEW_POLICY } from '../../../../src/review/session/review-policy';
import { getStoredSettings, setReviewOverrides } from '../../../../src/review/session/review-settings';
import {
	DIFF,
	TWO_UNIT_DIFF,
	addedFile,
	messagesOf,
	modelReply,
	restoreAfterEach,
	useTestModel
} from '../harness-fixtures';

restoreAfterEach();

const stack = { parent: null, children: [] };

const sources: IntentSource[] = [
	{ kind: 'pr', ref: 'pr', title: 'Cache intents', text: 'Cache the distilled intent. Retries are a follow-up.' },
	{ kind: 'issue', ref: 'issue:#9', title: 'Slow reruns', text: 'Reruns must not call the model again.' }
];

const contextReply = {
	summary: 'Caches the intent so reruns are free.',
	goals: [
		{ text: 'Reruns reuse the intent', source: 'issue:#9' },
		{ text: 'Cache the distilled intent', source: 'pr' },
		{ text: 'Invented claim', source: 'issue:#404' }
	],
	nonGoals: [{ text: 'Retries', source: 'pr' }]
};

const unitReply = {
	summary: 'Returns new instead of old.',
	observedChanges: [
		{ text: 'Now returns new', file: 'src/a.ts', line: '1' },
		{ text: 'Invented file', file: 'src/missing.ts', line: 3 },
		{ text: 'Invented line', file: 'src/a.ts', line: 999 }
	],
	openQuestions: [
		{ text: 'Does render() still accept old?', file: 'src/a.ts', line: 1 },
		{ text: 'Are callers of a() updated?', file: 'src/a.ts', line: 1 }
	]
};

/** The files a unit call names on its first line, or null for the context call. */
function unitFiles(init?: RequestInit): string[] | null {
	const user = String(messagesOf(init)[1]?.content ?? '');

	return /^Files: (.+)$/m.exec(user)?.[1].split(', ') ?? null;
}

/** Answers each unit call by its files and the context call with `contextReply`; every call is logged by kind. */
type Answer = (files: string[] | null) => Response | unknown;

let calls: string[] = [];

function stub(answer: Answer): void {
	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const files = unitFiles(init);

		calls.push(files ? files.join(',') : 'context');

		const reply = answer(files);

		return reply instanceof Response ? reply : modelReply(reply);
	}) as unknown as typeof fetch;
}

/** One statement about line 1 of each of the unit's files. */
const perFile: Answer = (files) =>
	files
		? {
				summary: `Adds ${files.join(' and ')}.`,
				observedChanges: files.map((file) => ({ text: `Adds ${file}`, file, line: 1 }))
			}
		: contextReply;

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-intent-'));
	useTestModel();
	calls = [];
	stub((files) => (files ? unitReply : contextReply));
});

const distill = (diff = DIFF, from = sources) => distillIntent(createRun({ diff, sandboxPath: null }), from, stack);

test('claims citing unknown refs are dropped and ids follow source order, not reply order', async () => {
	const intent = await distill();

	expect(intent?.goals).toEqual([
		{ id: 'G1', text: 'Reruns reuse the intent', source: 'issue:#9' },
		{ id: 'G2', text: 'Cache the distilled intent', source: 'pr' }
	]);

	expect(intent?.nonGoals).toEqual([{ id: 'N1', text: 'Retries', source: 'pr' }]);
	expect(calls).toEqual(['src/a.ts', 'context']);
});

test('a second distill of the same inputs reads the cache without calling the model', async () => {
	const first = await distill();
	const made = calls.length;
	const second = await distill();

	expect(calls).toHaveLength(made);
	expect(second).toEqual(first);
});

test('a changed model id or effort misses the cache, and returning to the first model hits it again', async () => {
	const original = getStoredSettings();

	await distill();

	const made = calls.length;

	setReviewOverrides({ ...original, models: [{ id: 'test', label: 'Test', model: 'test-2' }] });
	await distill();
	expect(calls.length).toBe(made * 2);

	setReviewOverrides({ ...original, orchestratorEffort: 'low' });
	await distill();
	expect(calls.length).toBe(made * 3);

	setReviewOverrides(original);
	await distill();
	expect(calls.length).toBe(made * 3);
});

test('a PR with an empty description is briefed from its code alone, and one with no code either is not distilled', async () => {
	const empty: IntentSource[] = [{ kind: 'pr', ref: 'pr', title: 'Tweak', text: '' }];

	expect(await distill('', empty)).toBeNull();
	expect(calls).toEqual([]);

	const intent = await distill(DIFF, empty);

	expect(calls).toEqual(['src/a.ts']);
	expect(intent?.summary).toBe('Returns new instead of old.');
	expect(intent?.observedChanges).toHaveLength(1);
});

test('statements about files or lines outside the unit are dropped, kept ones are pinned, and a moved head is briefed again', async () => {
	const intent = await distill();

	expect(intent?.observedChanges).toEqual([
		{ id: 'O1', text: 'Now returns new', file: 'src/a.ts', line: 1, unit: 'unit-1', range: { start: 1, end: 1 } }
	]);

	expect(intent?.openQuestions.map((claim) => claim.id + claim.text[0])).toEqual(['Q1A', 'Q2D']);

	const made = calls.length;

	await distill(DIFF.replace('+new', '+newer'));

	expect(calls.length).toBeGreaterThan(made);
});

test('a 30,000-character first file does not hide the two units after it', async () => {
	const diff = addedFile('a/big.ts', 300) + addedFile('b/x.ts', 140) + addedFile('c/y.ts', 140);

	expect(partitionUnits(createRun({ diff, sandboxPath: null }).inventory)).toHaveLength(3);

	stub(perFile);

	const intent = await distill(diff);

	expect(intent?.units?.map((unit) => [unit.id, unit.paths.join(','), unit.status, unit.reason])).toEqual([
		['unit-1', 'a/big.ts', 'partial', 'size'],
		['unit-2', 'b/x.ts', 'included', undefined],
		['unit-3', 'c/y.ts', 'included', undefined]
	]);

	expect(intent?.units?.[0].detail).toBe('a/big.ts: 237 of 300 diff lines shown');
	expect(intent?.observedChanges.map((claim) => claim.file)).toEqual(['a/big.ts', 'b/x.ts', 'c/y.ts']);
	expect(intent?.complete).toBe(false);
	expect(briefBlock(intent, [{ path: 'a/big.ts', hunkIds: [] }], false)).toContain('The brief read a clipped diff');
	expect(briefBlock(intent, [{ path: 'b/x.ts', hunkIds: [] }], false)).not.toContain('clipped');
});

test('a unit the partition sized to fit is briefed whole, not as partial', async () => {
	stub(perFile);

	const intent = await distill(addedFile('a/x.ts', 117) + addedFile('a/y.ts', 117));

	expect(intent?.units?.map((unit) => [unit.status, unit.reason])).toEqual([['included', undefined]]);
	expect(intent?.complete).toBe(true);
});

test('a placeholder answer is asked again once, then left out of the brief and the cache', async () => {
	stub((files) => (files ? { summary: '...', observedChanges: [], openQuestions: [] } : { summary: '…' }));

	const intent = await distill();

	expect(calls).toEqual(['src/a.ts', 'src/a.ts', 'context', 'context']);
	expect(intent?.units?.[0]).toMatchObject({ status: 'omitted', reason: 'model', summary: '' });
	expect(intent?.summary).toBe('');
	expect(intent?.complete).toBe(false);
	expect(readdirSync(join(process.env.RECODER_DATA_DIR!, 'cache', 'intent'))).toEqual([]);

	await distill();

	expect(calls).toHaveLength(8);
});

test('a real answer on the retry is accepted and cached', async () => {
	let first = true;

	stub((files) => {
		if (!files) return contextReply;
		if (!first) return unitReply;

		first = false;

		return {};
	});

	const intent = await distill();

	expect(intent?.units?.[0].status).toBe('included');
	expect(intent?.complete).toBe(true);

	await distill();

	expect(calls).toEqual(['src/a.ts', 'src/a.ts', 'context']);
});

test('a unit whose model call fails is recorded as omitted with the reason, and the brief still completes', async () => {
	stub((files) => {
		if (files?.includes('tests/b.ts')) return new Response('bad request', { status: 400 });

		return files ? perFile(files) : contextReply;
	});

	const intent = await distill(TWO_UNIT_DIFF);

	expect(intent?.units?.map((unit) => [unit.id, unit.status, unit.reason])).toEqual([
		['unit-1', 'included', undefined],
		['unit-2', 'omitted', 'model']
	]);

	expect(intent?.units?.[1].detail).toBeTruthy();
	expect(intent?.summary).toBe(contextReply.summary);
	expect(intent?.observedChanges.map((claim) => claim.file)).toEqual(['src/a.ts']);
	expect(intent?.complete).toBe(false);

	expect(briefBlock(intent, [{ path: 'tests/b.ts', hunkIds: [] }], true)).toBe(
		'The brief did not read this unit: the model call failed.'
	);

	expect(briefBlock(intent, [{ path: 'src/a.ts', hunkIds: [] }], true)).not.toContain('did not read');
	expect(intentBlock(intent)).toContain('Brief incomplete (1 of 2 units read in full)');
});

/** Answers like `perFile` after `ms`, counting the calls in flight at once. */
function slowStub(ms: number): { peak: () => number } {
	let inFlight = 0;
	let peak = 0;

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const files = unitFiles(init);

		calls.push(files ? files.join(',') : 'context');
		inFlight++;
		peak = Math.max(peak, inFlight);
		await new Promise((resolve) => setTimeout(resolve, ms));
		inFlight--;

		return modelReply(perFile(files));
	}) as unknown as typeof fetch;

	return { peak: () => peak };
}

const manyUnits = (count: number) => Array.from({ length: count }, (_, i) => addedFile(`d${i}/f.ts`, 200)).join('');

test('unit calls run at most as many at once as reviewers do', async () => {
	const { peak } = slowStub(20);
	const intent = await distill(manyUnits(20));

	expect(intent?.units).toHaveLength(20);
	expect(intent?.units?.every((unit) => unit.status === 'included')).toBe(true);
	expect(peak()).toBe(REVIEW_POLICY.maxConcurrentAssignments);
});

test('a unit call that found no model slot in time is made again and briefed', async () => {
	const policy = REVIEW_POLICY as { perCallDeadlineMs: number };
	const saved = policy.perCallDeadlineMs;

	policy.perCallDeadlineMs = 500;
	useTestModel(2);
	slowStub(200);

	try {
		const intent = await distill(manyUnits(8));

		expect(intent?.units?.map((unit) => unit.status)).toEqual(Array(8).fill('included'));
		expect(calls.filter((call) => call !== 'context')).toHaveLength(8);
	} finally {
		policy.perCallDeadlineMs = saved;
	}
});

test('past the review deadline every unit is recorded as omitted for time without a call', async () => {
	const run = createRun({ diff: TWO_UNIT_DIFF, sandboxPath: null });

	run.deadlineAt = reviewNow() - 1;

	const intent = await distillIntent(run, sources, stack);

	expect(calls).toEqual([]);
	expect(intent?.units?.map((unit) => unit.reason)).toEqual(['time', 'time']);
});

test('a reviewer is shown only the brief for its own files, and questions only when asked', async () => {
	const intent = await distill();
	const own = [{ path: 'src/a.ts', hunkIds: [] }];

	expect(briefBlock(intent, [{ path: 'src/b.ts', hunkIds: [] }], true)).toBe('');
	expect(briefBlock(intent, own, true)).toContain('Q1 src/a.ts:1');
	expect(briefBlock(intent, own, false)).toContain('O1 src/a.ts:1');
	expect(briefBlock(intent, own, false)).not.toContain('Q1');
});
