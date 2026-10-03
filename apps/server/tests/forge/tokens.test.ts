import { afterAll, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearToken, hasToken, setToken, tokenEnv } from '../../src/forge/tokens';

const originalDataDir = process.env.RECODER_DATA_DIR;

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-tokens-'));
});

/** The last test points RECODER_DATA_DIR at a file; this keeps it from leaking into later test files. */
function restoreDataDir(): void {
	if (originalDataDir === undefined) delete process.env.RECODER_DATA_DIR;
	else process.env.RECODER_DATA_DIR = originalDataDir;
}

afterAll(restoreDataDir);

test('saving another provider preserves tokens not loaded in memory', () => {
	const file = join(process.env.RECODER_DATA_DIR!, 'tokens.json');

	writeFileSync(file, JSON.stringify({ github: 'saved-github' }));
	setToken('gitlab', 'saved-gitlab');
	expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ github: 'saved-github', gitlab: 'saved-gitlab' });
	expect(statSync(file).mode & 0o777).toBe(0o600);
});

test('credentials survive a fresh process launched from another directory', () => {
	setToken('github', 'restart-token');

	const script =
		'import { tokenEnv } from ' +
		JSON.stringify(join(import.meta.dir, '../../src/forge/tokens.ts')) +
		'; console.log(tokenEnv("github").GH_TOKEN)';

	const result = Bun.spawnSync([process.execPath, '-e', script], {
		cwd: tmpdir(),
		env: { ...process.env, GH_TOKEN: '' },
		stdout: 'pipe',
		stderr: 'pipe'
	});

	expect(result.exitCode).toBe(0);
	expect(result.stdout.toString().trim()).toBe('restart-token');
});

/** Runs `fn` from a temp working directory holding a legacy `data/tokens.json` with a GitHub token. */
function inLegacyCwd(fn: () => void): void {
	const cwd = process.cwd();
	const legacy = mkdtempSync(join(tmpdir(), 'recoder-legacy-'));

	mkdirSync(join(legacy, 'data'));
	writeFileSync(join(legacy, 'data', 'tokens.json'), '{"github":"legacy"}');
	process.chdir(legacy);

	try {
		fn();
	} finally {
		process.chdir(cwd);
	}
}

test('falls back to the legacy CWD-relative tokens file', () => {
	try {
		inLegacyCwd(() => {
			expect(hasToken('github')).toBe(true);
			expect(tokenEnv('github')).toEqual({ GH_TOKEN: 'legacy' });
		});
	} finally {
		clearToken('github');
	}
});

test('disconnect does not resurrect legacy credentials', () => {
	inLegacyCwd(() => {
		clearToken('github');
		expect(JSON.parse(readFileSync(join(process.env.RECODER_DATA_DIR!, 'tokens.json'), 'utf8'))).toEqual({});
	});
});

test('failed writes and invalid stored data are not reported as successful saves', () => {
	const file = join(process.env.RECODER_DATA_DIR!, 'tokens.json');

	writeFileSync(file, '{broken');
	expect(() => setToken('github', 'replacement')).toThrow('refusing to overwrite');
	expect(readFileSync(file, 'utf8')).toBe('{broken');
	process.env.RECODER_DATA_DIR = file;
	expect(() => setToken('github', 'replacement')).toThrow();
});
