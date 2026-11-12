import { expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { providerErrorText } from '../../src/models/error-text';

test('a failed call keeps the provider text without the call key, key shapes, bearer tokens or home paths', () => {
	const text = providerErrorText(
		new Error(
			`401 from ${homedir()}/.local/share/opencode and /Users/someone/x: key my-own-key-123 rejected, ` +
				'"sk-or-v1-abcdef0123456789" and "Bearer eyJhbGciOiJIUzI1NiJ9.payload" are invalid'
		),
		['my-own-key-123', undefined]
	);

	expect(text).toBe(
		'401 from ~/.local/share/opencode and ~/x: key [redacted] rejected, "[redacted]" and "[redacted]" are invalid'
	);
});

test('a provider error with nothing secret in it is kept as it is', () => {
	expect(providerErrorText(new Error('AI_APICallError: Go usage limit exceeded'), [])).toBe(
		'AI_APICallError: Go usage limit exceeded'
	);
});

test('a bearer token the length cut would strand without its prefix is still removed', () => {
	const token = '0123456789abcdef0123456789abcdef';
	const message = `Bearer ${token} ${'x'.repeat(599 - token.length)}`;

	expect(providerErrorText(new Error(message), [])).not.toContain(token);
});

test('an authorization header quoted as JSON is removed with its value', () => {
	const text = providerErrorText(
		new Error('request failed: {"headers":{"Authorization":"Basic dXNlcjpwYXNzd29yZA=="}}'),
		[]
	);

	expect(text).toBe('request failed: {"headers":{"Authorization":"[redacted]"}}');
});
