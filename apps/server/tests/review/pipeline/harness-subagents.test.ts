import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdaptiveReview, type ReviewProgressCheckpoint } from '../../../src/review/pipeline/harness';
import {
	NOTHING,
	TWO_UNIT_DIFF,
	confirmingVerifier,
	finding,
	isVerifier,
	lensIdsOf,
	messagesOf,
	modelReply,
	restoreAfterEach,
	systemOf,
	unitOf,
	useTwoModels
} from './harness-fixtures';

restoreAfterEach();

const dataDir = process.env.RECODER_DATA_DIR;

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-subagents-'));
});

afterEach(() => {
	if (dataDir === undefined) delete process.env.RECODER_DATA_DIR;
	else process.env.RECODER_DATA_DIR = dataDir;
});

/** A subagent request over the whole of `path`. */
const ask = (concern: string, path: string) => ({
	concern,
	question: `Is ${concern} handled?`,
	scope: [{ path, hunkIds: [] }],
	why: 'Needs a look across the repo.'
});

const REQUESTS: Record<string, unknown[]> = {
	'unit-1/correctness': [ask('Callers of parse', 'src/a.ts'), ask('Error paths', 'src/a.ts')],
	'unit-2/correctness': [ask('Test isolation', 'tests/b.ts'), ask('Fixture reuse', 'tests/b.ts')]
};

/** Every lens assignment the review runs for `TWO_UNIT_DIFF`, all reviewers. */
const LENS_RECORDS = [...lensIdsOf('unit-1'), ...lensIdsOf('unit-2')].map((id) => [id, 'reviewer', 'done']);

/**
 * Both correctness lenses ask for two subagents, and every other lens asks for
 * one it isn't offered; every subagent reports a finding and asks for one more
 * subagent of its own. `unit-1/correctness` also reports a finding unless
 * `clean`. Records which subagents ran, and on which model, along with the
 * reviewer system prompts by assignment.
 */
function stubSubagents(clean = false) {
	const seen = {
		subagents: new Set<string>(),
		models: new Set<string>(),
		reviewerSystems: [] as string[],
		systemsByUnit: new Map<string, string>()
	};

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const system = systemOf(init);
		const unit = unitOf(init);

		if (unit) {
			seen.reviewerSystems.push(system);
			seen.systemsByUnit.set(unit, system);
		}

		if (system.includes('Role: subagent')) {
			seen.subagents.add(/^Subagent (\S+):/m.exec(messagesOf(init)[1].content)?.[1] ?? '?');
			seen.models.add(JSON.parse(String(init?.body)).model);

			return modelReply({
				message: 'ok',
				...NOTHING,
				findings: [finding('deep miss')],
				subagents: [ask('Even deeper', 'src/a.ts')]
			});
		}

		if (isVerifier(init)) return modelReply(confirmingVerifier(init));

		const reply = {
			...NOTHING,
			findings: unit === 'unit-1/correctness' && !clean ? [finding('possible miss')] : [],
			subagents: unit ? (REQUESTS[unit] ?? [ask('Off-lens ask', 'src/a.ts')]) : []
		};

		return modelReply({ message: 'ok', ...reply });
	}) as unknown as typeof fetch;

	return seen;
}

test('only correctness lenses get subagents, the cap holds across units, and requests past it are named in the summary', async () => {
	useTwoModels();

	const seen = stubSubagents();
	const result = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null, subagentCap: 2 });

	expect(result.assignments.map((record) => [record.id, record.role, record.status])).toEqual([
		...LENS_RECORDS,
		['subagent-1', 'subagent', 'done'],
		['subagent-2', 'subagent', 'done']
	]);

	expect(result.assignments.filter((record) => record.role === 'subagent').map((record) => record.title)).toEqual([
		'Callers of parse',
		'Error paths'
	]);

	expect([...seen.subagents].sort()).toEqual(['subagent-1', 'subagent-2']);
	expect([...seen.models]).toEqual(['worker']);
	expect(result.assignments.find((record) => record.id === 'subagent-1')?.candidateCount).toBe(1);
	expect(result.summary).toContain('2 subagent requests went over the limit');
	expect(result.summary).toContain('Test isolation (tests/b.ts · Correctness)');
	expect(result.summary).toContain('Fixture reuse (tests/b.ts · Correctness)');

	for (const [unit, system] of seen.systemsByUnit) {
		expect([unit, system.includes('in "subagents" (at most 2)')]).toEqual([unit, unit.endsWith('/correctness')]);
	}
});

test('a subagent’s own subagent requests, and those from lenses other than correctness, are ignored', async () => {
	useTwoModels();

	const seen = stubSubagents();
	const saved: string[][] = [];

	const result = await runAdaptiveReview(
		{ diff: TWO_UNIT_DIFF, sandboxPath: null, subagentCap: 4 },
		{ onCheckpoint: (checkpoint) => saved.push(checkpoint.subagents.requests.map((entry) => entry.request.concern)) }
	);

	expect([...seen.subagents].sort()).toEqual(['subagent-1', 'subagent-2', 'subagent-3', 'subagent-4']);
	expect(saved.at(-1)).toHaveLength(4);
	expect(saved.flat()).not.toContain('Even deeper');
	expect(saved.flat()).not.toContain('Off-lens ask');
	expect(result.assignments.filter((record) => record.role === 'subagent')).toHaveLength(4);
	expect(result.summary).not.toContain('over the limit');
});

test('subagents the reviewers asked for run even when no reviewer raised a finding', async () => {
	useTwoModels();

	const seen = stubSubagents(true);
	const result = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null, subagentCap: 2 });

	expect(seen.subagents.size).toBe(2);
	expect(result.assignments.filter((record) => record.role === 'subagent')).toHaveLength(2);
});

test('with subagents off, reviewers aren’t offered any and none run', async () => {
	useTwoModels();

	const seen = stubSubagents();
	const result = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null, subagentCap: 0 });

	expect(seen.subagents.size).toBe(0);
	expect(result.assignments.every((record) => record.role === 'reviewer')).toBe(true);
	expect(result.summary).not.toContain('subagent');
	expect(seen.reviewerSystems.some((system) => system.includes('in "subagents" (at most'))).toBe(false);
});

test('a resumed review reruns only the subagent that failed, without planning again', async () => {
	useTwoModels();

	stubSubagents();

	const answer = globalThis.fetch;
	let saved: ReviewProgressCheckpoint | null = null;

	globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
		if (messagesOf(init)[1]?.content.includes('Subagent subagent-2:'))
			return new Response('bad request', { status: 400 });

		return answer(url, init);
	}) as unknown as typeof fetch;

	const failed = await runAdaptiveReview(
		{ diff: TWO_UNIT_DIFF, sandboxPath: null, subagentCap: 2 },
		{ onCheckpoint: (checkpoint) => (saved = checkpoint) }
	);

	expect(failed.assignments.find((record) => record.id === 'subagent-2')?.status).toBe('error');
	expect(failed.summary).toContain('1 subagent did not finish.');

	const again = stubSubagents();
	const resumed = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null, subagentCap: 2, resume: saved });

	expect(again.reviewerSystems).toEqual([]);
	expect([...again.subagents]).toEqual(['subagent-2']);

	expect(resumed.assignments.map((record) => [record.id, record.role, record.status])).toEqual([
		...LENS_RECORDS,
		['subagent-1', 'subagent', 'done'],
		['subagent-2', 'subagent', 'done']
	]);
});

const QUESTION = 'Does parse() still accept an empty string?';

/**
 * A brief with one open question on `src/a.ts` line 1. The lens assignments in
 * `marking` mark it unsettled; every reviewer is otherwise empty, so any
 * subagent that runs came from the question. Records the user prompt of each
 * subagent by id, and the log lines.
 */
function stubBrief(marking: string[]) {
	const seen = { subagentPrompts: new Map<string, string>() };

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const system = systemOf(init);

		if (system.includes('You write the brief')) {
			return modelReply({ openQuestions: [{ text: QUESTION, file: 'src/a.ts', line: 1 }] });
		}

		if (system.includes('Role: subagent')) {
			const prompt = messagesOf(init)[1].content;

			seen.subagentPrompts.set(/^Subagent (\S+):/m.exec(prompt)?.[1] ?? '?', prompt);

			return modelReply({ message: 'ok', ...NOTHING });
		}

		if (isVerifier(init)) return modelReply(confirmingVerifier(init));

		const unit = unitOf(init);

		return modelReply({ message: 'ok', ...NOTHING, unsettled: unit && marking.includes(unit) ? ['Q1', 'Q99'] : [] });
	}) as unknown as typeof fetch;

	return seen;
}

test('a question two reviewers left unsettled gets a subagent whose prompt carries it', async () => {
	useTwoModels();

	const seen = stubBrief(['unit-1/correctness', 'unit-1/security']);
	const logs: string[] = [];

	const result = await runAdaptiveReview(
		{ diff: TWO_UNIT_DIFF, sandboxPath: null, subagentCap: 3 },
		{ onLog: (message) => logs.push(message) }
	);

	const subagents = result.assignments.filter((record) => record.role === 'subagent');

	expect(subagents.map((record) => record.status)).toEqual(['done']);
	expect(seen.subagentPrompts.get('subagent-1')).toContain(QUESTION);
	expect(seen.subagentPrompts.get('subagent-1')).toContain('marked unsettled by 2 reviewers');

	expect(logs.filter((line) => line.includes('subagent'))).toEqual([
		expect.stringContaining('0 from reviewer requests, 1 from unsettled')
	]);
});

test('a question nothing addressed gets a subagent even though no reviewer marked it', async () => {
	useTwoModels();

	const seen = stubBrief([]);
	const logs: string[] = [];

	await runAdaptiveReview(
		{ diff: TWO_UNIT_DIFF, sandboxPath: null, subagentCap: 3 },
		{ onLog: (message) => logs.push(message) }
	);

	expect(seen.subagentPrompts.get('subagent-1')).toContain('no reviewer reported on it');
	expect(logs.filter((line) => line.includes('subagent'))).toEqual([expect.stringContaining('1 from unaddressed')]);
});

test('with subagents off, an open question runs no subagent', async () => {
	useTwoModels();

	const seen = stubBrief(['unit-1/correctness']);

	await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null, subagentCap: 0 });

	expect(seen.subagentPrompts.size).toBe(0);
});

test('a checkpoint saved before unsettled marks existed resumes and still plans its subagents', async () => {
	useTwoModels();
	stubSubagents();

	let beforePlanning: ReviewProgressCheckpoint | null = null;

	await runAdaptiveReview(
		{ diff: TWO_UNIT_DIFF, sandboxPath: null, subagentCap: 2 },
		{
			onCheckpoint: (checkpoint) => {
				if (!checkpoint.subagents.units) beforePlanning = checkpoint;
			}
		}
	);

	const { requests } = beforePlanning!.subagents;
	const old = { ...beforePlanning!, subagents: { requests, units: null, dropped: [] } };

	const resumed = await runAdaptiveReview({
		diff: TWO_UNIT_DIFF,
		sandboxPath: null,
		subagentCap: 2,
		resume: old as unknown as ReviewProgressCheckpoint
	});

	expect(resumed.assignments.filter((record) => record.role === 'subagent').map((record) => record.status)).toEqual([
		'done',
		'done'
	]);
});
