import { afterEach, beforeEach, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretKeyError, loadSecretKey, secretKey, secretKeyFile } from '../../src/secrets/secret-key';

const saved = { key: process.env.RECODER_SECRET_KEY, config: process.env.XDG_CONFIG_HOME };

let configHome: string;

beforeEach(() => {
	configHome = mkdtempSync(join(tmpdir(), 'recoder-key-'));
	process.env.XDG_CONFIG_HOME = configHome;
	delete process.env.RECODER_SECRET_KEY;
});

afterEach(() => {
	process.env.XDG_CONFIG_HOME = saved.config;
	if (saved.key === undefined) delete process.env.RECODER_SECRET_KEY;
	else process.env.RECODER_SECRET_KEY = saved.key;
});

test('the key file is made on first use, private, outside the data folder', () => {
	const { key, source } = secretKey();
	const file = join(configHome, 'recoder', 'secret.key');

	expect(secretKeyFile()).toBe(file);
	expect(source).toEqual({ kind: 'file', path: file });
	expect(key).toHaveLength(32);
	expect(statSync(file).mode & 0o777).toBe(0o600);
	expect(statSync(join(configHome, 'recoder')).mode & 0o777).toBe(0o700);
	expect(file.startsWith(process.env.RECODER_DATA_DIR!)).toBe(false);
});

test('a restart reads the same key from the file', () => {
	const first = secretKey().key;

	const script =
		`import { secretKey } from ${JSON.stringify(join(import.meta.dir, '../../src/secrets/secret-key.ts'))};` +
		'console.log(secretKey().key.toString("base64"))';

	const result = Bun.spawnSync([process.execPath, '-e', script], {
		cwd: tmpdir(),
		env: { ...process.env, RECODER_DATABASE_URL: '' },
		stdout: 'pipe',
		stderr: 'pipe'
	});

	expect(result.exitCode).toBe(0);
	expect(result.stdout.toString().trim()).toBe(first.toString('base64'));
	expect(readFileSync(secretKeyFile(), 'utf8').trim()).toBe(first.toString('base64'));
});

test('RECODER_SECRET_KEY wins and no key file is made', () => {
	const key = randomBytes(32);

	process.env.RECODER_SECRET_KEY = key.toString('base64');

	expect(secretKey()).toEqual({ key, source: { kind: 'env' } });
	expect(existsSync(secretKeyFile())).toBe(false);
});

test('replicas sharing a database refuse to start without RECODER_SECRET_KEY', () => {
	const keyFile = join(configHome, 'recoder', 'secret.key');

	expect(() => loadSecretKey({ envKey: undefined, isShared: true, keyFile })).toThrow(SecretKeyError);
	expect(() => loadSecretKey({ envKey: undefined, isShared: true, keyFile })).toThrow('RECODER_SECRET_KEY is required');
	expect(existsSync(keyFile)).toBe(false);
});

test('replicas sharing a database start with RECODER_SECRET_KEY', () => {
	const envKey = randomBytes(32);

	expect(loadSecretKey({ envKey, isShared: true, keyFile: join(configHome, 'secret.key') }).key).toEqual(envKey);
});

test('a key file that is not a 32-byte base64 key is refused, and its content is not quoted', () => {
	const keyFile = join(configHome, 'bad.key');

	writeFileSync(keyFile, 'hunter2-not-a-key');

	try {
		loadSecretKey({ envKey: undefined, isShared: false, keyFile });
		expect.unreachable();
	} catch (error) {
		expect(error).toBeInstanceOf(SecretKeyError);
		expect((error as Error).message).toContain(keyFile);
		expect((error as Error).message).not.toContain('hunter2');
	}
});
