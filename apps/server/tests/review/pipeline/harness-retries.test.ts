import { expect, test } from 'bun:test';
import { failedUnits, runAdaptiveReview, unfinishedAssignments } from '../../../src/review/pipeline/harness';
import {
	NOTHING,
	TWO_UNIT_DIFF,
	lensIdsOf,
	messagesOf,
	modelReply,
	restoreAfterEach,
	unitOf,
	useTestModel
} from './harness-fixtures';

restoreAfterEach();

/** A failed unit record whose last operation reads `currentOperation`. */
const failedRecord = (currentOperation: string) => ({
	id: 'unit-1/security',
	role: 'reviewer',
	title: 'c',
	reason: 'r',
	scope: [],
	status: 'error' as const,
	currentOperation
});

test('a lens assignment that failed reruns once under the same lens, told how it failed, and the orchestrator says so', async () => {
	useTestModel();

	const prompts: string[] = [];

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const unit = unitOf(init);

		/** The first unit-2 correctness reviewer only ever narrates, the failure seen with small models. */
		if (unit?.endsWith('unit-2/correctness')) prompts.push(String(messagesOf(init)[1]?.content ?? ''));

		const reply = unit === 'unit-2/correctness' ? {} : NOTHING;

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

	expect(result.assignments).toHaveLength(2 * lensIdsOf('unit-1').length + 1);
	expect(statuses.get('unit-2/correctness')).toBe('error');
	expect(statuses.get('retry-unit-2/correctness')).toBe('done');
	expect([...statuses].filter(([, status]) => status !== 'done').map(([id]) => id)).toEqual(['unit-2/correctness']);

	expect(prompts.at(-1)).toContain('Retry: the first attempt failed');
	expect(notes).toHaveLength(1);
	expect(notes[0]).toContain('with a strict reply format');
});

test('a lens assignment that ran out of room is retried under its lens as two halves of its scope, and a cancelled one is not retried', () => {
	const unit = {
		id: 'unit-1/security',
		title: 'src · Security',
		reason: 'r',
		lens: 'security' as const,
		scope: [
			{ path: 'src/a.ts', hunkIds: ['h1', 'h2'] },
			{ path: 'src/b.ts', hunkIds: ['h3'] }
		]
	};

	const retries = failedUnits([unit], [failedRecord('Model output truncated at the output-token limit')]);

	expect(retries.map((retry) => [retry.unit.id, retry.unit.lens, retry.unit.scope])).toEqual([
		['retry-unit-1/security-a', 'security', [{ path: 'src/a.ts', hunkIds: ['h1', 'h2'] }]],
		['retry-unit-1/security-b', 'security', [{ path: 'src/b.ts', hunkIds: ['h3'] }]]
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
