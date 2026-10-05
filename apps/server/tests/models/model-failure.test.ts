import { expect, test } from 'bun:test';
import { LlmError } from '../../src/models/llm';
import { modelFailure } from '../../src/models/model-failure';

test('a signed-out ChatGPT call asks the developer to sign in', () => {
	expect(
		modelFailure(new LlmError(401, 'Your ChatGPT sign-in expired. Sign in again.'), { provider: 'codex' }, 'fallback')
	).toEqual({ reason: 'Your ChatGPT sign-in expired. Sign in again.', signIn: true });
});

test('a ChatGPT permission error is not treated as signed out', () => {
	expect(
		modelFailure(
			new LlmError(403, 'ChatGPT denied access. Check model access and workspace permissions.'),
			{ provider: 'codex' },
			'fallback'
		).signIn
	).toBeUndefined();
});

test('a raw endpoint error body never becomes the reason', () => {
	const auth = modelFailure(
		new LlmError(401, 'LLM 401: {"error":{"message":"Incorrect API key sk-live-123"}}'),
		{ provider: 'openai-compatible' },
		'fallback'
	);

	expect(auth.reason).not.toContain('sk-live');
	expect(auth.signIn).toBeUndefined();

	expect(
		modelFailure(new LlmError(500, 'LLM 500: <html>upstream</html>'), { provider: 'openai-compatible' }, 'fallback')
			.reason
	).toBe('fallback');
});

test('a ChatGPT 429 is an out-of-usage failure, not a retry', () => {
	const failure = modelFailure(
		new LlmError(429, 'ChatGPT usage limit reached. See Settings → Models for reset times.'),
		{ provider: 'codex' },
		'fallback'
	);

	expect(failure.usageLimit).toEqual({ provider: 'codex', name: 'ChatGPT', usageUrl: null });
});

test('a hosted plan that ran out names the provider and where to check usage', () => {
	const failure = modelFailure(
		new LlmError(402, 'LLM 402: {"error":"insufficient credits"}'),
		{ provider: 'openai-compatible', source: 'openrouter' },
		'fallback'
	);

	expect(failure.usageLimit?.name).toBe('OpenRouter');
	expect(failure.usageLimit?.usageUrl).toContain('openrouter.ai');
	expect(failure.reason).not.toContain('insufficient');
});

test('a rejected hosted key names the provider to reconnect', () => {
	expect(
		modelFailure(new LlmError(401, 'LLM 401: {}'), { provider: 'openai-compatible', source: 'opencode-go' }, 'fallback')
			.reason
	).toContain('OpenCode Go');
});

test('an overloaded self-hosted server is a plain failure, not out of usage', () => {
	expect(modelFailure(new LlmError(429, 'LLM 429: busy'), { provider: 'openai-compatible' }, 'fallback')).toEqual({
		reason: 'fallback'
	});
});

test('an OpenCode provider that rejects its key points to the Agent settings', () => {
	const failure = modelFailure(
		new LlmError(401, 'Key revoked'),
		{ provider: 'opencode', source: 'openai' },
		'fallback'
	);

	expect(failure.reason).toContain('Settings → Agent');
	expect(failure.signIn).toBeUndefined();
});

test("an OpenCode 403 keeps the provider's message instead of asking to reconnect", () => {
	expect(
		modelFailure(
			new LlmError(403, 'Free tier is not available here.'),
			{ provider: 'opencode', source: 'opencode' },
			'fallback'
		)
	).toEqual({ reason: 'Free tier is not available here.' });
});

test('an OpenCode 429 about a spent quota is out of usage for that provider', () => {
	const failure = modelFailure(
		new LlmError(429, 'Rate limit reached: usage limit for 5 hours, resets at 09:00'),
		{ provider: 'opencode', source: 'openai' },
		'fallback'
	);

	expect(failure.usageLimit).toMatchObject({ provider: 'openai', usageUrl: null });
});

test('an OpenCode 429 that only throttles requests is not reported as out of usage', () => {
	const failure = modelFailure(
		new LlmError(429, 'Rate limit reached for requests'),
		{ provider: 'opencode', source: 'zai-coding-plan' },
		'fallback'
	);

	expect(failure.usageLimit).toBeUndefined();
});
