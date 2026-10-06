import { expect, test } from 'bun:test';
import { claudeCodeError } from '../../../src/agents/claude-code/claude-code-reply';

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
