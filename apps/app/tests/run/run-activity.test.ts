import { describe, expect, test } from 'bun:test';
import { emptyReviewProgress, type ReviewProgress, type ReviewToolCall } from '@recoder/shared';

import { runActivity } from '../../src/lib/run/run-activity';

function progress(change: Partial<ReviewProgress>): ReviewProgress {
	return { ...emptyReviewProgress('rv1'), ...change };
}

function tool(change: Partial<ReviewToolCall>): ReviewToolCall {
	return { id: 't1', command: '', status: 'done', exitCode: null, startedAt: '', ...change };
}

const LOG_LINE = { sequence: 1, message: 'rule ledger model turn 6/1 (grok-4.6)', at: '' };

describe('what a running review says it does', () => {
	test('a server log line is never shown, so a review with no tool call says nothing', () => {
		const logged = progress({ activity: [LOG_LINE] });

		expect(runActivity(logged)).toBeNull();
	});

	test('the running call wins over a newer finished one', () => {
		const reading = tool({
			id: 'read',
			status: 'running',
			command: 'read src/limiter.ts:61-84',
			input: { action: 'readFile', path: 'src/limiter.ts', startLine: 61, endLine: 84 }
		});

		const searched = tool({
			id: 'search',
			command: 'search "refill" src',
			input: { action: 'search', query: 'refill', prefix: 'src' }
		});

		expect(runActivity(progress({ toolCalls: [reading, searched], activity: [LOG_LINE] }))).toEqual({
			verb: 'Reading',
			subject: 'src/limiter.ts, lines 61–84'
		});
	});

	test('a command with no structured request drops the shell prompt', () => {
		const setup = tool({ status: 'running', command: '$ bun install' });

		expect(runActivity(progress({ toolCalls: [setup] }))).toEqual({ verb: 'Running', subject: 'bun install' });
	});
});
