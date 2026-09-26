import { expect, test } from 'bun:test';
import { LlmError } from './llm';
import { modelFailure } from './model-failure';

test('a signed-out ChatGPT call asks the developer to sign in', () => {
	expect(modelFailure(new LlmError(401, 'Your ChatGPT sign-in expired. Sign in again.'), 'codex', 'fallback'))
		.toEqual({ reason: 'Your ChatGPT sign-in expired. Sign in again.', signIn: true });
});

test('a ChatGPT permission error is not treated as signed out', () => {
	expect(modelFailure(new LlmError(403, 'ChatGPT denied access. Check model access and workspace permissions.'), 'codex', 'fallback').signIn).toBeUndefined();
});

test('a raw endpoint error body never becomes the reason', () => {
	const auth = modelFailure(new LlmError(401, 'LLM 401: {"error":{"message":"Incorrect API key sk-live-123"}}'), 'openai-compatible', 'fallback');
	expect(auth.reason).not.toContain('sk-live');
	expect(auth.signIn).toBeUndefined();
	expect(modelFailure(new LlmError(500, 'LLM 500: <html>upstream</html>'), 'openai-compatible', 'fallback').reason).toBe('fallback');
});
