import { expect, test } from 'bun:test';
import { ReplyReader, claudeCodeError } from '../../../src/agents/claude-code/claude-code-reply';

test('a failure without an error code is classified by its wording', () => {
	expect(claudeCodeError('Not logged in · Please run /login', null, null).status).toBe(401);
	expect(claudeCodeError('Claude usage limit reached. Your limit will reset at 5pm.', null, null).status).toBe(429);
	expect(claudeCodeError('API Error: 500 Internal server error', null, 500).status).toBe(500);
	expect(claudeCodeError('Something odd happened', null, null).status).toBe(0);
});

test('a reply cut at the output limit is reported as truncated, so it is not retried', () => {
	expect(claudeCodeError('Response exceeded the output token maximum.', 'max_output_tokens', null).message).toContain(
		'truncated'
	);
});

test('a result that says the tool call could not be parsed is an error, not a reply', () => {
	const reader = new ReplyReader({});

	reader.line(
		JSON.stringify({
			type: 'result',
			subtype: 'success',
			is_error: false,
			terminal_reason: 'malformed_tool_use_exhausted',
			result: "The model's tool call could not be parsed (retry also failed)."
		})
	);

	expect(() => reader.finish(undefined, { code: 0, stderr: '' })).toThrow('tool call could not be parsed');
});

/** A reader that has read a successful result line carrying `usage`, and the usage it reports. */
function reportedUsage(usage: object): unknown {
	const reader = new ReplyReader({});
	let reported: unknown = 'none';

	reader.line(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', usage }));
	reader.finish((value) => (reported = value), { code: 0, stderr: '' });

	return reported;
}

test('a result that counts no tokens reports them as unknown, not as zero', () => {
	expect(reportedUsage({})).toMatchObject({
		inputTokens: null,
		outputTokens: null,
		totalTokens: null,
		cachedInputTokens: null
	});

	expect(reportedUsage({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 })).toMatchObject({
		inputTokens: 110,
		outputTokens: 5,
		totalTokens: 115,
		cachedInputTokens: 100,
		cacheWriteInputTokens: null
	});
});
