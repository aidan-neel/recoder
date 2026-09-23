import { expect, test } from 'bun:test';
import type { ReviewChatMessage, ReviewToolCall } from '@recoder/shared';
import { groupTranscript, taskGroupLabel, toolPresentation } from '../../../web/src/lib/review-transcript';
import { applyProgressMessage, emptyReviewProgress } from '../../../web/src/lib/review-progress-state';

const tool = (id: string, second: number, action = 'readDiff'): ReviewToolCall => ({ id, command: `${action} file.ts`, input: { action, path: 'file.ts' }, startedAt: `2026-01-01T00:00:0${second}Z`, status: 'done', exitCode: null });
const message = (id: string, second: number, text = 'An actual answer.'): ReviewChatMessage => ({ id, assignmentId: '__pipeline', from: 'assistant', at: `2026-01-01T00:00:0${second}Z`, text, status: 'done' });

test('tools form stable groups between messages and summary dumps stay out of the transcript', () => {
	const messages = [message('pending', 0, ''), message('answer', 3), message('review-result', 4, 'Specialists: internal inventory dump')];
	const tools = [tool('a', 1), tool('b', 2), tool('c', 5, 'search')];
	const groups = groupTranscript(messages, tools);
	expect(groups.map((group) => [group.kind, group.id])).toEqual([['tasks', 'a'], ['message', 'answer'], ['tasks', 'c']]);
	expect(groups[0].kind === 'tasks' && groups[0].tools.map((item) => item.id)).toEqual(['a', 'b']);
	const updated = groupTranscript(messages, [...tools, tool('d', 6)]);
	expect(updated.at(-1)?.id).toBe('c');
	expect(taskGroupLabel([tool('a', 1), tool('b', 2), tool('c', 3, 'search')])).toBe('Read 2 files, searched once');
});

test('persisted malformed retrievals render through both snapshots and live events', () => {
	// Actual legacy shape: the model supplied type instead of action, and the
	// failed retrieval was persisted without a command after JSON serialization.
	const malformed = JSON.parse(JSON.stringify({
		id: 'tool_7', input: { type: 'readDiff', path: 'packages/sivir/cli/commands/status.ts' },
		status: 'error', exitCode: null, startedAt: '2026-09-18T18:22:06.079Z',
		summary: 'unsupported action', result: { content: '', truncated: false, error: 'unsupported action' }
	})) as ReviewToolCall;
	const initial = emptyReviewProgress('review');
	const snapshot = { ...initial, sequence: 1, toolCalls: [malformed] };
	const restored = applyProgressMessage(initial, { type: 'snapshot', snapshot });
	const live = applyProgressMessage(initial, { type: 'tool', sequence: 1, data: { tool: malformed } });
	for (const progress of [restored, live]) {
		const groups = groupTranscript([], progress.toolCalls!);
		expect(taskGroupLabel(progress.toolCalls!)).toBe('Ran 1 tool');
		expect(groups[0].kind).toBe('tasks');
		expect(toolPresentation(progress.toolCalls![0])).toEqual({ action: '', target: malformed.input!.path!, name: `Tool request ${malformed.input!.path}` });
		expect(progress.toolCalls![0].result?.error).toBe('unsupported action');
	}
});

test('tool presentation tolerates missing or non-string labels without losing valid inputs', () => {
	const missing = { ...tool('missing', 1), command: undefined, input: undefined } as unknown as ReviewToolCall;
	expect(toolPresentation(missing)).toEqual({ action: '', target: '', name: 'Tool request' });
	expect(taskGroupLabel([missing, tool('valid', 2)])).toBe('Read 1 file, ran 1 tool');
	const read = { ...missing, input: { action: 'readFile', path: 'src/a.ts' } };
	expect(toolPresentation(read)).toEqual({ action: 'readFile', target: 'src/a.ts', name: 'readFile src/a.ts' });
	const invalid = { ...missing, command: 42, input: { action: {}, path: false } } as unknown as ReviewToolCall;
	expect(toolPresentation(invalid)).toEqual({ action: '', target: '', name: 'Tool request' });
});
