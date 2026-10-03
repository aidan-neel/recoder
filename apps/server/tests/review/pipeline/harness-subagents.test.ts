import { expect, test } from 'bun:test';
import { runAdaptiveReview, type ReviewProgressCheckpoint } from '../../../src/review/pipeline/harness';
import {
	KEEP_NONE,
	NOTHING,
	TWO_UNIT_DIFF,
	finding,
	messagesOf,
	modelReply,
	restoreAfterEach,
	systemOf,
	unitOf,
	useTwoModels
} from './harness-fixtures';

restoreAfterEach();

/** A subagent request over the whole of `path`. */
const ask = (concern: string, path: string) => ({
	concern,
	question: `Is ${concern} handled?`,
	scope: [{ path, hunkIds: [] }],
	why: 'Needs a look across the repo.'
});

const REQUESTS: Record<string, unknown[]> = {
	'unit-1': [ask('Callers of parse', 'src/a.ts'), ask('Error paths', 'src/a.ts')],
	'unit-2': [ask('Test isolation', 'tests/b.ts'), ask('Fixture reuse', 'tests/b.ts')]
};

/**
 * Both reviewers ask for two subagents; every subagent reports a finding and
 * asks for one more subagent of its own. Records which subagents ran, and on
 * which model, along with the reviewer system prompts.
 */
function stubSubagents() {
	const seen = { subagents: new Set<string>(), models: new Set<string>(), reviewerSystems: [] as string[] };

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const system = systemOf(init);
		const unit = unitOf(init);

		if (unit) seen.reviewerSystems.push(system);

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

		const reply = unit ? { ...NOTHING, subagents: REQUESTS[unit] ?? [] } : KEEP_NONE;

		return modelReply({ message: 'ok', ...reply });
	}) as unknown as typeof fetch;

	return seen;
}

test('the cap holds across units: the first unit’s requests run on the second model, and the rest are named in the summary', async () => {
	useTwoModels();

	const seen = stubSubagents();
	const result = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null, subagentCap: 2 });

	expect(result.assignments.map((record) => [record.id, record.role, record.title, record.status])).toEqual([
		['unit-1', 'reviewer', 'src/a.ts', 'done'],
		['unit-2', 'reviewer', 'tests/b.ts', 'done'],
		['subagent-1', 'subagent', 'Callers of parse', 'done'],
		['subagent-2', 'subagent', 'Error paths', 'done']
	]);

	expect([...seen.subagents].sort()).toEqual(['subagent-1', 'subagent-2']);
	expect([...seen.models]).toEqual(['worker']);
	expect(result.assignments.find((record) => record.id === 'subagent-1')?.candidateCount).toBe(1);
	expect(result.summary).toContain('2 subagent requests went over the limit');
	expect(result.summary).toContain('Test isolation (tests/b.ts)');
	expect(result.summary).toContain('Fixture reuse (tests/b.ts)');
	expect(seen.reviewerSystems.every((system) => system.includes('in "subagents" (at most 2)'))).toBe(true);
});

test('a subagent’s own subagent requests are ignored', async () => {
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
	expect(result.assignments.filter((record) => record.role === 'subagent')).toHaveLength(4);
	expect(result.summary).not.toContain('over the limit');
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

	expect(resumed.assignments.map((record) => [record.id, record.status])).toEqual([
		['unit-1', 'done'],
		['unit-2', 'done'],
		['subagent-1', 'done'],
		['subagent-2', 'done']
	]);
});
