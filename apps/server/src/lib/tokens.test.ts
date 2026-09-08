import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearToken, setToken, tokenEnv } from './tokens';

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-tokens-'));
});

test('saving another provider preserves tokens not loaded in memory', () => {
	const file = join(process.env.RECODER_DATA_DIR!, 'tokens.json');
	writeFileSync(file, JSON.stringify({ github: 'saved-github' }));
	setToken('gitlab', 'saved-gitlab');
	expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ github: 'saved-github', gitlab: 'saved-gitlab' });
	expect(statSync(file).mode & 0o777).toBe(0o600);
});

test('credentials survive a fresh process launched from another directory', () => {
	setToken('github', 'restart-token');
	const script = 'import { tokenEnv } from ' + JSON.stringify(join(import.meta.dir, 'tokens.ts')) + '; console.log(tokenEnv("github").GH_TOKEN)';
	const result = Bun.spawnSync([process.execPath, '-e', script], {
		cwd: tmpdir(),
		env: { ...process.env, GH_TOKEN: '' },
		stdout: 'pipe', stderr: 'pipe'
	});
	expect(result.exitCode).toBe(0);
	expect(result.stdout.toString().trim()).toBe('restart-token');
});

test('disconnect does not resurrect legacy credentials', () => {
	const cwd = process.cwd();
	const legacy = mkdtempSync(join(tmpdir(), 'recoder-legacy-'));
	mkdirSync(join(legacy, 'data'));
	writeFileSync(join(legacy, 'data', 'tokens.json'), '{"github":"legacy"}');
	process.chdir(legacy);
	try {
		clearToken('github');
		expect(JSON.parse(readFileSync(join(process.env.RECODER_DATA_DIR!, 'tokens.json'), 'utf8'))).toEqual({});
	} finally {
		process.chdir(cwd);
	}
});

test('failed writes and invalid stored data are not reported as successful saves', () => {
	const file = join(process.env.RECODER_DATA_DIR!, 'tokens.json');
	writeFileSync(file, '{broken');
	expect(() => setToken('github', 'replacement')).toThrow('refusing to overwrite');
	expect(readFileSync(file, 'utf8')).toBe('{broken');
	process.env.RECODER_DATA_DIR = file;
	expect(() => setToken('github', 'replacement')).toThrow();
});
