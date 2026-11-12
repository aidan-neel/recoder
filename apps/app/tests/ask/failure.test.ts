import { expect, test } from 'bun:test';

import { ApiError } from '../../src/lib/api/http';
import { chatFailure } from '../../src/lib/ask/failure';

test('raw CLI output in a chat failure reaches the transcript as plain copy', () => {
	const error = new ApiError('gh not authenticated: [stderr]\nHTTP 401: Bad credentials (https://api.github.com)', 502);

	expect(chatFailure(error).message).toBe('GitHub rejected the token. Update it in Settings → Connections.');
});

test('a chat failure whose message names a member of every object reads as a sentence', () => {
	expect(chatFailure(new ApiError('constructor', 500)).message).toBe('Constructor.');
});
