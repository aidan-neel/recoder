import { expect, test } from 'bun:test';
import { failedUnits, runAdaptiveReview, unfinishedAssignments } from '../../../src/review/pipeline/harness';
import {
	KEEP_NONE,
	NOTHING,
	TWO_UNIT_DIFF,
	messagesOf,
	modelReply,
	restoreAfterEach,
	unitOf,
	useTestModel
} from './harness-fixtures';

restoreAfterEach();

/** A failed unit record whose last operation reads `currentOperation`. */
const failedRecord = (currentOperation: string) => ({
	id: 'unit-1',
	role: 'reviewer',
	title: 'c',
	reason: 'r',
	scope: [],
	status: 'error' as const,
	currentOperation
});

test('a unit whose reviewer failed reruns once, told how it failed, and the orchestrator says so', async () => {
	useTestModel();

	const prompts: string[] = [];

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const unit = unitOf(init);

		/** The first unit-2 reviewer only ever narrates, the failure seen with small models. */
		if (unit?.endsWith('unit-2')) prompts.push(String(messagesOf(init)[1]?.content ?? ''));

		const reply = unit === 'unit-2' ? {} : unit ? NOTHING : KEEP_NONE;

		return modelReply({ message: 'Reading the queue code.', ...reply });
	}) as unknown as typeof fetch;

	const notes: string[] = [];

	const result = await runAdaptiveReview(
		{ diff: TWO_UNIT_DIFF, sandboxPath: null },
		{
			onMessage: (message) => {
				if (message.id.startsWith('message_retries_')) notes.push(message.text);
			}
		}
	);

	expect(result.assignments.map((record) => [record.id, record.status])).toEqual([
		['unit-1', 'done'],
		['unit-2', 'error'],
		['retry-unit-2', 'done']
	]);

	expect(prompts.at(-1)).toContain('Retry: the first attempt failed');
	expect(notes).toHaveLength(1);
	expect(notes[0]).toContain('with a strict reply format');
});

test('a unit that ran out of room is retried as two halves of its scope, and a cancelled one is not retried', () => {
	const unit = {
		id: 'unit-1',
		title: 'src',
		reason: 'r',
		scope: [
			{ path: 'src/a.ts', hunkIds: ['h1', 'h2'] },
			{ path: 'src/b.ts', hunkIds: ['h3'] }
		]
	};

	const retries = failedUnits([unit], [failedRecord('Model output truncated at the output-token limit')]);

	expect(retries.map((retry) => [retry.unit.id, retry.unit.scope])).toEqual([
		['retry-unit-1-a', [{ path: 'src/a.ts', hunkIds: ['h1', 'h2'] }]],
		['retry-unit-1-b', [{ path: 'src/b.ts', hunkIds: ['h3'] }]]
	]);

	expect(failedUnits([unit], [failedRecord('Review cancelled.')])).toEqual([]);
});

test('a unit whose retry also failed counts as one unfinished unit, and one whose retry finished counts as none', () => {
	const record = (id: string, status: 'done' | 'error' | 'skipped') => ({
		id,
		role: 'reviewer',
		title: id,
		reason: 'r',
		scope: [],
		status
	});

	expect(
		unfinishedAssignments([
			record('a', 'error'),
			record('retry-a', 'error'),
			record('b', 'error'),
			record('retry-b', 'done'),
			record('c', 'skipped')
		]).map((item) => item.id)
	).toEqual(['retry-a']);

	expect(
		unfinishedAssignments([record('d', 'error'), record('retry-d-a', 'done'), record('retry-d-b', 'error')]).map(
			(item) => item.id
		)
	).toEqual(['retry-d-b']);
});
