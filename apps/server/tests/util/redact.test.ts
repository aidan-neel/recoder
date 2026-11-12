import { expect, test } from 'bun:test';
import { redacted, redactedTail } from '../../src/util/redact';

/** A made-up token holding characters a URL encodes. */
const SECRET = 'fake-T0ken/with:odd+chars';

/** How long a redacted tail may be. */
const TAIL_CHARS = 600;

test('a known secret is removed when every byte of it is percent-encoded, in either hex case', () => {
	for (const encoded of [encodeEveryByte(SECRET), encodeEveryByte(SECRET).toUpperCase()]) {
		const tail = redactedTail(`fatal: could not read ${encoded} from the remote`, [SECRET]);

		expect(tail).toBe('fatal: could not read [redacted] from the remote');
	}
});

test('a known secret is removed when only some of its characters are percent-encoded', () => {
	const partlyEncoded = [encodeURIComponent(SECRET), encodeEveryByte(SECRET.slice(0, 8)) + SECRET.slice(8)];

	for (const encoded of partlyEncoded) {
		expect(redactedTail(`token ${encoded} refused`, [SECRET])).toBe('token [redacted] refused');
	}
});

test('a known secret the length cut would split is removed before the cut', () => {
	const tailOfSecret = SECRET.slice(-5);
	const text = SECRET + '.'.repeat(TAIL_CHARS - tailOfSecret.length);

	const tail = redactedTail(text, [SECRET]);

	expect(tail).toHaveLength(TAIL_CHARS);
	expect(tail).not.toContain(tailOfSecret);
});

test('user info and an authorization value are removed when their separators are percent-encoded', () => {
	const text = [
		'url=https%3A%2F%2Fuser%3AURL-SECRET%40example.test%2Fr.git',
		'Authorization%3A%20Bearer%20HEADER-SECRET'
	].join('\n');

	const tail = redactedTail(text, []);

	expect(tail).not.toContain('URL-SECRET');
	expect(tail).not.toContain('HEADER-SECRET');
	expect(tail).toContain('example.test');
});

/** `text` with every UTF-8 byte written as `%xx` in lower-case hex. */
function encodeEveryByte(text: string): string {
	return [...new TextEncoder().encode(text)].map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join('');
}

test('a provider key is removed from a header, a parameter and a JSON field that name it', () => {
	const key = 'zz-made-up-key-0123456789';

	const text = [`x-api-key: ${key}`, `GET /v1/models?api_key=${key}&page=2`, `{"apiKey":"${key}","model":"m"}`].join(
		'\n'
	);

	const shown = redacted(text, []);

	expect(shown).not.toContain(key);
	expect(shown).toContain('page=2');
	expect(shown).toContain('"model":"m"');
});

test('a password quoted as a JSON field is removed, and a token count beside it stays', () => {
	const shown = redacted('{"password":"hunter2-made-up","totalTokens":1234}', []);

	expect(shown).not.toContain('hunter2-made-up');
	expect(shown).toContain('"totalTokens":1234');
});

test('the path token of a leased tool slot is removed from a URL a CLI quotes', () => {
	const shown = redacted(
		'Error: MCP server recoder1 failed: connect ECONNREFUSED http://127.0.0.1:41873/mcp/Zm9vYmFyLXRva2VuLTEyMzQ1Njc4',
		[]
	);

	expect(shown).toContain('http://127.0.0.1:41873/mcp/[redacted]');
	expect(shown).not.toContain('Zm9vYmFy');
});
