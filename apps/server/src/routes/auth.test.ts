import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../app';
import { clearToken, hasToken, initTokenStore, setToken, tokenEnv } from '../lib/tokens';

describe('tokens', () => {
	test('set/has/env/clear round-trip', () => {
		expect(hasToken('github')).toBe(false);
		setToken('github', 'secret');
		expect(hasToken('github')).toBe(true);
		expect(tokenEnv('github')).toEqual({ GH_TOKEN: 'secret' });
		expect(tokenEnv('gitlab')).toEqual({});
		clearToken('github');
		expect(hasToken('github')).toBe(false);
	});

	test('persist across init (restart)', () => {
		const dir = mkdtempSync(join(tmpdir(), 'recoder-data-'));
		process.env.RECODER_DATA_DIR = dir;
		try {
			setToken('github', 'persisted');
			expect(JSON.parse(readFileSync(join(dir, 'tokens.json'), 'utf8'))).toEqual({
				github: 'persisted'
			});
			clearToken('github');
			// Simulate a restart: drop memory, reload from disk.
			setToken('gitlab', 'glpersist');
			initTokenStore();
			expect(hasToken('gitlab')).toBe(true);
			expect(tokenEnv('gitlab')).toEqual({ GITLAB_TOKEN: 'glpersist' });
			clearToken('gitlab');
		} finally {
			delete process.env.RECODER_DATA_DIR;
			clearToken('github');
			clearToken('gitlab');
		}
	});
});

describe('auth', () => {
	test('GET /api/auth/status reports both providers', async () => {
		const res = await app.request('/api/auth/status');
		expect(res.status).toBe(200);
		const body = await res.json();
		for (const key of ['github', 'gitlab'] as const) {
			expect(typeof body[key].available).toBe('boolean');
			expect(body[key].authenticated).toBe(false);
			expect(body[key].user).toBeNull();
		}
	});

	test('POST /api/auth/token rejects bogus tokens', async () => {
		const res = await app.request('/api/auth/token', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ provider: 'github', token: 'bogus' })
		});
		expect(res.status).toBe(401);
		expect(hasToken('github')).toBe(false);
	});

	test('POST /api/auth/token validates input', async () => {
		const res = await app.request('/api/auth/token', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ provider: 'bitbucket', token: 'x' })
		});
		expect(res.status).toBe(400);
	});

	test('GET /api/auth/repos needs a provider', async () => {
		const res = await app.request('/api/auth/repos?provider=bitbucket');
		expect(res.status).toBe(400);
	});

	test('GET /api/auth/repos surfaces CLI errors as 502', async () => {
		const res = await app.request('/api/auth/repos?provider=github');
		expect(res.status).toBe(502);
		const body = await res.json();
		expect(typeof body.kind).toBe('string');
	});
});
