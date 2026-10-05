import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun } from '../../../../src/review/pipeline/harness/context';
import { briefBlock } from '../../../../src/review/pipeline/intent/brief';
import { distillIntent } from '../../../../src/review/pipeline/intent/distill';
import type { IntentSource } from '../../../../src/review/pipeline/intent/types';
import { DIFF, modelReply, restoreAfterEach, useTestModel } from '../harness-fixtures';

restoreAfterEach();

const stack = { parent: null, children: [] };

const sources: IntentSource[] = [
	{ kind: 'pr', ref: 'pr', title: 'Cache intents', text: 'Cache the distilled intent. Retries are a follow-up.' },
	{ kind: 'issue', ref: 'issue:#9', title: 'Slow reruns', text: 'Reruns must not call the model again.' }
];

const reply = {
	summary: 'Caches the intent so reruns are free.',
	goals: [
		{ text: 'Reruns reuse the intent', source: 'issue:#9' },
		{ text: 'Cache the distilled intent', source: 'pr' },
		{ text: 'Invented claim', source: 'issue:#404' }
	],
	acceptanceCriteria: [],
	statedConstraints: [],
	nonGoals: [{ text: 'Retries', source: 'pr' }],
	priorDecisions: [],
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

let calls = 0;

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-intent-'));
	useTestModel();
	calls = 0;

	globalThis.fetch = (async () => {
		calls++;

		return modelReply(reply);
	}) as unknown as typeof fetch;
});

test('claims citing unknown refs are dropped and ids follow source order, not reply order', async () => {
	const intent = await distillIntent(createRun({ diff: DIFF, sandboxPath: null }), sources, stack);

	expect(intent?.goals).toEqual([
		{ id: 'G1', text: 'Reruns reuse the intent', source: 'issue:#9' },
		{ id: 'G2', text: 'Cache the distilled intent', source: 'pr' }
	]);

	expect(intent?.nonGoals).toEqual([{ id: 'N1', text: 'Retries', source: 'pr' }]);
});

test('a second distill of the same sources reads the cache without calling the model', async () => {
	const first = await distillIntent(createRun({ diff: DIFF, sandboxPath: null }), sources, stack);
	const second = await distillIntent(createRun({ diff: DIFF, sandboxPath: null }), sources, stack);

	expect(calls).toBe(1);
	expect(second).toEqual(first);
});

test('a PR with an empty description is briefed from its code, and one with no code either is not distilled', async () => {
	const empty: IntentSource[] = [{ kind: 'pr', ref: 'pr', title: 'Tweak', text: '' }];

	expect(await distillIntent(createRun({ diff: '', sandboxPath: null }), empty, stack)).toBeNull();
	expect(calls).toBe(0);

	const intent = await distillIntent(createRun({ diff: DIFF, sandboxPath: null }), empty, stack);

	expect(intent?.observedChanges).toHaveLength(1);
});

test('statements about files or lines outside the change are dropped, and a head that moved is briefed again', async () => {
	const intent = await distillIntent(createRun({ diff: DIFF, sandboxPath: null }), sources, stack);

	expect(intent?.observedChanges).toEqual([{ id: 'O1', text: 'Now returns new', file: 'src/a.ts', line: 1 }]);
	expect(intent?.openQuestions.map((claim) => claim.id + claim.text[0])).toEqual(['Q1A', 'Q2D']);

	await distillIntent(createRun({ diff: DIFF.replace('+new', '+newer'), sandboxPath: null }), sources, stack);

	expect(calls).toBe(2);
});

test('a reviewer is shown only the brief for its own files, and questions only when asked', async () => {
	const intent = await distillIntent(createRun({ diff: DIFF, sandboxPath: null }), sources, stack);
	const own = [{ path: 'src/a.ts', hunkIds: [] }];

	expect(briefBlock(intent, [{ path: 'src/b.ts', hunkIds: [] }], true)).toBe('');
	expect(briefBlock(intent, own, true)).toContain('Q1 src/a.ts:1');
	expect(briefBlock(intent, own, false)).toContain('O1 src/a.ts:1');
	expect(briefBlock(intent, own, false)).not.toContain('Q1');
});
