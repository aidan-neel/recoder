import { expect, test } from 'bun:test';
import { failedUnits, runAdaptiveReview, unfinishedAssignments } from '../../../src/review/pipeline/harness';
import {
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
	id: 'reviewer-1',
	role: 'reviewer',
	title: 'c',
	reason: 'r',
	scope: [],
	status: 'error' as const,
	currentOperation
});

test('a reviewer that failed reruns once, told how it failed, and the orchestrator says so', async () => {
	useTestModel();

	const prompts: string[] = [];

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const unit = unitOf(init);

		/** The first reviewer-2 only ever narrates, the failure seen with small models. */
		if (unit?.endsWith('reviewer-2')) prompts.push(String(messagesOf(init)[1]?.content ?? ''));

		const reply = unit === 'reviewer-2' ? {} : NOTHING;

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

	const statuses = new Map(result.assignments.map((record) => [record.id, record.status]));

	expect(result.assignments).toHaveLength(3);
	expect(statuses.get('reviewer-2')).toBe('error');
	expect(statuses.get('retry-reviewer-2')).toBe('done');
	expect([...statuses].filter(([, status]) => status !== 'done').map(([id]) => id)).toEqual(['reviewer-2']);

	expect(prompts.at(-1)).toContain('Retry: the first attempt failed');
	expect(notes).toHaveLength(1);
	expect(notes[0]).toContain('with a strict reply format');
});

test('a reviewer that ran out of room is retried as two halves of its scope, and a cancelled one is not retried', () => {
	const unit = {
		id: 'reviewer-1',
		title: 'Reviewer 1 · src',
		reason: 'r',
		lenses: ['correctness' as const, 'security' as const],
		scope: [
			{ path: 'src/a.ts', hunkIds: ['h1', 'h2'] },
			{ path: 'src/b.ts', hunkIds: ['h3'] }
		]
	};

	const retries = failedUnits([unit], [failedRecord('Model output truncated at the output-token limit')]);

	expect(retries.map((retry) => [retry.unit.id, retry.unit.lenses, retry.unit.scope])).toEqual([
		['retry-reviewer-1-a', ['correctness', 'security'], [{ path: 'src/a.ts', hunkIds: ['h1', 'h2'] }]],
		['retry-reviewer-1-b', ['correctness', 'security'], [{ path: 'src/b.ts', hunkIds: ['h3'] }]]
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
