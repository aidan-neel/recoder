import { describe, expect, test } from 'bun:test';
import { emptyReviewProgress, type ReviewProgress, type ReviewToolCall } from '@recoder/shared';

import { createMemory, remember, studioView } from '../../src/lib/studio/studio-view';

const AT = '2026-11-23T10:00:00.000Z';

function call(id: string, owner: string, action: string, extra: Partial<ReviewToolCall> = {}): ReviewToolCall {
	return {
		id,
		assignmentId: owner,
		command: id,
		status: 'done',
		exitCode: 0,
		startedAt: AT,
		input: { action },
		...extra
	};
}

/** A review with one reviewer on one two-hunk file and one candidate it raised, verified on lane 2. */
function progress(calls: ReviewToolCall[]): ReviewProgress {
	return {
		...emptyReviewProgress('review-1'),
		assignments: [
			{
				id: 'part-1',
				role: 'reviewer',
				title: 'The core change',
				reason: '',
				status: 'running',
				scope: [{ path: 'src/a.ts', hunkIds: ['h1', 'h2'] }]
			}
		],
		tasks: {
			'verify:c1': {
				id: 'verify:c1',
				label: 'Verify: Leak',
				status: 'running',
				message: 'Running code',
				kind: 'verification',
				candidateId: 'c1',
				verifierId: 'verifier-2',
				updatedAt: AT
			}
		},
		candidates: [
			{
				id: 'c1',
				title: 'Leak',
				path: 'src/a.ts',
				tier: 'bug',
				raisedBy: 'part-1',
				raisedAt: AT,
				state: 'verifying',
				verifierId: 'verifier-2'
			}
		],
		toolCalls: calls
	};
}

describe('studioView', () => {
	test('a verifier keeps its steps and a file its read hunks after the stream drops their calls', () => {
		const memory = createMemory();

		const early = [
			call('read-1', 'part-1', 'readDiff', { input: { action: 'readDiff', path: 'src/a.ts', hunkIds: ['h1'] } }),
			call('v-1', 'verify:c1', 'readFile', { input: { action: 'readFile', path: 'src/a.ts' } }),
			call('v-2', 'verify:c1', 'run', { input: { action: 'run', command: 'bun test' } }),
			call('v-3', 'verify:c1', 'run', { input: { action: 'run', command: 'bun test' } })
		];

		remember(memory, early);

		const view = studioView(progress([]), memory);

		expect(view.chains.get('c1')?.map((step) => [step.kind, step.agent, step.count])).toEqual([
			['raised', 'part-1', 1],
			['traced', 'verifier-2', 1],
			['ran', 'verifier-2', 2]
		]);

		expect(view.rooms[0].files[0]).toMatchObject({ read: 1, hunks: 2, done: false });
	});

	test('a running diff read does not count its hunks until it finishes', () => {
		const memory = createMemory();

		const running = call('read-1', 'part-1', 'readDiff', {
			status: 'running',
			input: { action: 'readDiff', path: 'src/a.ts', hunkIds: ['h1', 'h2'] }
		});

		remember(memory, [running]);

		const view = studioView(progress([running]), memory);

		expect(view.rooms[0].files[0]).toMatchObject({ read: 0, done: false });
		expect(view.agents.find((agent) => agent.id === 'part-1')).toMatchObject({ verb: 'reading', path: 'src/a.ts' });
	});
});
