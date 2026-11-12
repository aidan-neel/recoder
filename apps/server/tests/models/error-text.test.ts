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
