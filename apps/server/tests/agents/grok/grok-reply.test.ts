import { describe, expect, test } from 'bun:test';
import { grokError } from '../../../src/agents/grok/grok-reply';
import { LlmError, UsageLimitError } from '../../../src/models/llm/errors';

describe('grokError', () => {
	test('maps the CLI failure wording to the contract statuses', () => {
		for (const [text, status, usageLimit] of [
			['Rate limit exceeded, retry in 20s.', 429, false],
			['Error: too many requests, slow down', 429, false],
			['You have reached your usage limit. Resets at 3pm UTC.', 429, true],
			['Monthly quota exhausted.', 429, true],
			['Error: insufficient credit on this account', 402, true],
			['Error: out of credits', 402, true],
			['Error: billing is past due', 402, true],
			['Error: invalid credentials', 0, false],
			['Error: insufficient permissions for this model', 0, false],
			['Error: Not logged in. Run `grok login` to sign in.', 401, false]
		] as const) {
			const error = grokError(text);

			expect(error).toBeInstanceOf(LlmError);
			expect(error.status).toBe(status);
			expect(error instanceof UsageLimitError).toBe(usageLimit);
		}
	});
});
