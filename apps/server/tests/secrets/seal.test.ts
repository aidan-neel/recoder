import { afterEach, beforeEach, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { configuredSecretKey } from '../../src/env';
import { SealedValueError, isSealed, open, openStored, seal } from '../../src/secrets/seal';

const savedKey = process.env.RECODER_SECRET_KEY;

beforeEach(() => {
	process.env.RECODER_SECRET_KEY = randomBytes(32).toString('base64');
});

afterEach(() => {
	if (savedKey === undefined) delete process.env.RECODER_SECRET_KEY;
	else process.env.RECODER_SECRET_KEY = savedKey;
});

test('a sealed value opens to what was sealed and does not show it', () => {
	const sealed = seal('forge-token:github', 'gho_secret_value');

	expect(sealed).toStartWith('enc:v1:');
	expect(sealed).not.toContain('gho_secret_value');
	expect(open('forge-token:github', sealed)).toBe('gho_secret_value');
});

test('the same value sealed twice gives different text', () => {
	expect(seal('forge-token:github', 'same')).not.toBe(seal('forge-token:github', 'same'));
});

test('a tampered ciphertext is refused', () => {
	const sealed = seal('forge-token:github', 'gho_secret_value');
	const bytes = Buffer.from(sealed.slice('enc:v1:'.length), 'base64');

	bytes[bytes.length - 1] ^= 1;

	expect(() => open('forge-token:github', `enc:v1:${bytes.toString('base64')}`)).toThrow(SealedValueError);
});

test('a truncated value is refused', () => {
	expect(() => open('forge-token:github', 'enc:v1:AAAA')).toThrow(SealedValueError);
});

test('a value sealed under another key is refused', () => {
	const sealed = seal('forge-token:github', 'gho_secret_value');

	process.env.RECODER_SECRET_KEY = randomBytes(32).toString('base64');

	expect(() => open('forge-token:github', sealed)).toThrow(SealedValueError);
});

test('a value sealed for one purpose does not open for another', () => {
	const sealed = seal('forge-token:github', 'gho_secret_value');

	expect(() => open('forge-token:gitlab', sealed)).toThrow(SealedValueError);
});

test('the error names the purpose and never the value or the key', () => {
	const sealed = seal('forge-token:github', 'gho_secret_value');

	try {
		open('vllm-key:v1', sealed);
		expect.unreachable();
	} catch (error) {
		const text = `${(error as Error).message} ${(error as Error).stack}`;

		expect((error as SealedValueError).purpose).toBe('vllm-key:v1');
		expect(text).toContain('vllm-key:v1');
		expect(text).not.toContain('gho_secret_value');
		expect(text).not.toContain(process.env.RECODER_SECRET_KEY!);
	}
});

test('a stored value without the prefix is plaintext from before sealing', () => {
	expect(isSealed('gho_plain')).toBe(false);
	expect(openStored('forge-token:github', 'gho_plain')).toBe('gho_plain');
	expect(openStored('forge-token:github', seal('forge-token:github', 'gho_sealed'))).toBe('gho_sealed');
});

test('a malformed RECODER_SECRET_KEY is refused, naming the variable and not its value', () => {
	for (const invalid of ['not-base64!', Buffer.alloc(16).toString('base64'), Buffer.alloc(33).toString('base64')]) {
		process.env.RECODER_SECRET_KEY = invalid;

		expect(() => configuredSecretKey()).toThrow('RECODER_SECRET_KEY must be 32 bytes as base64');
		expect(() => seal('forge-token:github', 'x')).toThrow('RECODER_SECRET_KEY must be 32 bytes');
	}
});
