import { expect, test } from 'bun:test';
import {
	failedAssignments,
	runAdaptiveReview,
	unfinishedAssignments,
	uniqueIds
} from '../../../src/review/pipeline/harness';
import {
	DIFF,
	KEEP_NONE,
	NOTHING,
	PLAN,
	assignment,
	messagesOf,
	modelReply,
	restoreAfterEach,
	useTestModel
} from './harness-fixtures';

restoreAfterEach();

/** A failed assignment record whose last operation reads `currentOperation`. */
const failedRecord = (currentOperation: string) => ({
	id: 'correctness-core',
	role: 'correctness' as const,
	title: 'c',
	reason: 'r',
	scope: [],
	status: 'error' as const,
	currentOperation
});

test('a specialist that kept failing reruns on its own, told how it failed, and the orchestrator says so', async () => {
	useTestModel();

	const prompts: string[] = [];

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const messages = messagesOf(init);
		const system = String(messages[0]?.content ?? '');
		const user = String(messages[1]?.content ?? '');

		/** The first patterns specialist only ever narrates, the failure seen with small models. */
		const firstPatterns = system.includes('(patterns)') && !user.includes('Retry:');

		if (system.includes('(patterns)')) prompts.push(user);

		const reply = system.includes('review orchestrator')
			? PLAN
			: firstPatterns
				? {}
				: system.includes('Role:')
					? NOTHING
					: KEEP_NONE;

		return modelReply({ message: 'Reading the queue code.', ...reply });
	}) as unknown as typeof fetch;

	const notes: string[] = [];

	const result = await runAdaptiveReview(
		{ diff: DIFF, sandboxPath: null },
		{
			onMessage: (message) => {
				if (message.id.startsWith('message_retries_')) notes.push(message.text);
			}
		}
	);

	expect(result.assignments.map((record) => [record.id, record.status])).toEqual([
		['correctness-core', 'done'],
		['patterns-core', 'error'],
		['retry-patterns-core', 'done']
	]);

	expect(prompts.at(-1)).toContain('Retry: the first attempt failed');
	expect(notes).toHaveLength(1);
	expect(notes[0]).toContain('with a strict reply format');
});

test('a specialist that ran out of room is retried as two halves of its scope', () => {
	const item = {
		...assignment('correctness-core', 'correctness', 1),
		scope: [
			{ path: 'src/a.ts', hunkIds: ['h1', 'h2'] },
			{ path: 'src/b.ts', hunkIds: ['h3'] }
		]
	};

	const retries = failedAssignments([item], [failedRecord('Model output truncated at the output-token limit')]);

	expect(retries.map((retry) => [retry.item.id, retry.item.scope])).toEqual([
		['retry-correctness-core-a', [{ path: 'src/a.ts', hunkIds: ['h1', 'h2'] }]],
		['retry-correctness-core-b', [{ path: 'src/b.ts', hunkIds: ['h3'] }]]
	]);

	expect(failedAssignments([item], [failedRecord('Review cancelled.')])).toEqual([]);
});

test('a follow-up reusing a launched assignment id gets its own id', () => {
	const follow = [
		assignment('patterns-core', 'patterns', 3),
		assignment('follow-x', 'security', 4),
		assignment('follow-x', 'security', 5)
	];

	expect(uniqueIds(follow, ['patterns-core', 'follow-patterns-core', 'follow-x']).map((item) => item.id)).toEqual([
		'follow-patterns-core-2',
		'follow-x-2',
		'follow-x-3'
	]);
});

test('a specialist whose retry also failed counts as one unfinished review, and one whose retry finished counts as none', () => {
	const record = (id: string, status: 'done' | 'error' | 'skipped') => ({
		id,
		role: 'correctness' as const,
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
