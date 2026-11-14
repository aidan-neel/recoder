import { afterAll, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearToken, hasToken, initTokenStore, setToken, tokenEnv } from '../../src/forge/tokens';
import { SealedValueError } from '../../src/secrets/seal';

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

test('saving another provider preserves tokens not loaded in memory, sealed', () => {
	const file = join(process.env.RECODER_DATA_DIR!, 'tokens.json');

	writeFileSync(file, JSON.stringify({ github: 'saved-github' }));
	setToken('gitlab', 'saved-gitlab');

	const stored = JSON.parse(readFileSync(file, 'utf8'));

	expect(stored.github).toStartWith('enc:v1:');
	expect(stored.gitlab).toStartWith('enc:v1:');
	expect(tokenEnv('github').GH_TOKEN).toBe('saved-github');
	expect(tokenEnv('gitlab').GITLAB_TOKEN).toBe('saved-gitlab');
	expect(statSync(file).mode & 0o777).toBe(0o600);
});

test('a plaintext tokens file from before sealing is sealed at start and still works', () => {
	const file = join(process.env.RECODER_DATA_DIR!, 'tokens.json');

	writeFileSync(file, JSON.stringify({ github: 'gho_plain_github', gitlab: 'glpat_plain_gitlab' }), { mode: 0o600 });
	initTokenStore();

	const raw = readFileSync(file, 'utf8');

	expect(raw).not.toContain('gho_plain_github');
	expect(raw).not.toContain('glpat_plain_gitlab');
	expect(JSON.parse(raw).github).toStartWith('enc:v1:');
	expect(tokenEnv('github').GH_TOKEN).toBe('gho_plain_github');
	expect(tokenEnv('gitlab').GITLAB_TOKEN).toBe('glpat_plain_gitlab');
});

test('a sealed token copied to the other provider does not open', () => {
	const file = join(process.env.RECODER_DATA_DIR!, 'tokens.json');

	setToken('github', 'gho_only_github');

	const { github } = JSON.parse(readFileSync(file, 'utf8'));

	writeFileSync(file, JSON.stringify({ gitlab: github }));
	expect(() => tokenEnv('gitlab')).toThrow(SealedValueError);
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
