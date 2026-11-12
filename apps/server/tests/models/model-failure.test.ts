import { expect, test } from 'bun:test';
import { claudeCodeError } from '../../src/agents/claude-code/claude-code-reply';
import { failureError } from '../../src/agents/custom/custom-protocol';
import { LlmError, isTransientLlmError } from '../../src/models/llm';
import { isUsageLimit, modelFailure } from '../../src/models/model-failure';
import { providerError } from '../../src/agents/opencode/opencode-error';

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
		providerError(429, 'Rate limit reached: usage limit for 5 hours, resets at 09:00'),
		{ provider: 'opencode', source: 'openai' },
		'fallback'
	);

	expect(failure.usageLimit).toMatchObject({ provider: 'openai', usageUrl: null });
});

test("OpenCode Go's quota error, which carries no status, stops the review as out of usage", () => {
	const words = 'AI_APICallError: Go usage limit exceeded';
	const overOpenCode = { provider: 'opencode', source: 'opencode-go' } as const;

	expect(isUsageLimit(providerError(0, words), overOpenCode)).toBe(true);
	expect(isUsageLimit(new LlmError(0, words), { provider: 'openai-compatible', source: 'opencode-go' })).toBe(true);
	expect(isUsageLimit(new LlmError(0, words), { provider: 'openai-compatible' })).toBe(false);
	expect(isUsageLimit(providerError(0, 'socket hang up'), overOpenCode)).toBe(false);
});

test('an OpenCode 429 that only throttles requests is not reported as out of usage', () => {
	const failure = modelFailure(
		providerError(429, 'Rate limit reached for requests'),
		{ provider: 'opencode', source: 'zai-coding-plan' },
		'fallback'
	);

	expect(failure.usageLimit).toBeUndefined();
});

test('a signed-out Claude Code call names the login command, not a key', () => {
	const error = claudeCodeError(
		'Failed to authenticate: OAuth session expired and could not be refreshed',
		'authentication_failed',
		null
	);

	const failure = modelFailure(error, { provider: 'claude-code' }, 'fallback');

	expect(failure.reason).toContain('Claude Code is not signed in');
	expect(failure.reason).toContain('claude auth login');
	expect(failure.signIn).toBeUndefined();
	expect(failure.usageLimit).toBeUndefined();
});

test('a Claude Code usage limit stops as out of usage with its reset time, and is never retried', () => {
	const error = claudeCodeError("You've hit your limit · resets 3pm (UTC)", 'rate_limit', 429);
	const failure = modelFailure(error, { provider: 'claude-code' }, 'fallback');

	expect(failure.usageLimit).toEqual({ provider: 'claude-code', name: 'Claude Code', usageUrl: null });
	expect(failure.reason).toContain('Claude Code is out of usage');
	expect(failure.reason).toContain('resets 3pm (UTC)');
	expect(isTransientLlmError(error)).toBe(false);
});

test('a custom command’s spent plan stops as out of usage under its name, and is never retried', () => {
	const error = failureError('usage_limit', 'plan spent until 3pm', 'My agent');
	const failure = modelFailure(error, { provider: 'custom-command' }, 'fallback');

	expect(failure.usageLimit).toEqual({ provider: 'custom-command', name: 'Custom command', usageUrl: null });
	expect(failure.reason).toContain('plan spent until 3pm');
	expect(isTransientLlmError(error)).toBe(false);
});

test('a signed-out custom command keeps its own message instead of asking for an API key', () => {
	const failure = modelFailure(
		failureError('auth', 'run my-agent login', 'My agent'),
		{ provider: 'custom-command' },
		''
	);

	expect(failure).toEqual({ reason: 'My agent is not signed in: run my-agent login' });
});
