import { expect, test } from 'bun:test';
import type { ReviewChatMessage, ReviewToolCall } from '@recoder/shared';
import { groupTranscript, taskGroupLabel } from '../../../web/src/lib/review-transcript';

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
	expect(taskGroupLabel([tool('a', 1), tool('b', 2), tool('c', 3, 'search')])).toBe('2 file reads · 1 search');
});
