import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { app } from '../../src/app';
import { capturedEnv, type ServerIdentity } from '../../src/eval/server-identity';
import { sourceVersion } from '../../src/eval/source-hash';

const PLANTED = 'sk-planted-identity-test-key';
const PLANTED_NAMES = ['RECODER_REVIEW_API_KEY', 'RECODER_TEST_STRENGTH', 'RECODER_NEW_SWITCH', 'RECODER_FORGE_TOKEN'];
const saved = Object.fromEntries(PLANTED_NAMES.map((name) => [name, process.env[name]]));

/** Read by the server but never a flag: where it keeps files and how it reaches its model. */
const NOT_A_FLAG = [
	'RECODER_DATA_DIR',
	'RECODER_WORKDIR',
	'RECODER_OPENCODE_BIN',
	'RECODER_REVIEW_API_KEY',
	'RECODER_REVIEW_BASE_URL'
];

afterEach(() => {
	for (const name of PLANTED_NAMES) {
		if (saved[name] === undefined) delete process.env[name];
		else process.env[name] = saved[name];
	}
});

test('GET /health/identity records every RECODER_ switch, cache versions and tools, never a key', async () => {
	process.env.RECODER_REVIEW_API_KEY = PLANTED;
	process.env.RECODER_FORGE_TOKEN = PLANTED;
	process.env.RECODER_TEST_STRENGTH = '1';
	process.env.RECODER_NEW_SWITCH = 'on';

	const response = await app.request('/health/identity');
	const text = await response.text();
	const identity = JSON.parse(text) as ServerIdentity;

	expect(response.status).toBe(200);
	expect(text).not.toContain(PLANTED);
	expect(text).not.toContain(process.env.RECODER_DATA_DIR!);
	expect(Object.keys(identity.flags).every((name) => name.startsWith('RECODER_'))).toBe(true);
	expect(identity.flags).not.toHaveProperty('RECODER_REVIEW_API_KEY');
	expect(identity.flags.RECODER_TEST_STRENGTH).toBe('1');
	expect(identity.flags.RECODER_NEW_SWITCH).toBe('on');
	expect(identity.caches.intent).toMatch(/^source:[0-9a-f]{16}$/);
	expect(identity.code).toBe(sourceVersion());
	expect(identity.caches['review-checkpoint']).toMatch(/^v\d+$/);
	expect(identity.tools.bun).toBe(Bun.version);
	expect(identity.tools.opencode).toBe('not installed');
	expect(identity.policy.analysisDeadlineMs).toBeGreaterThan(0);
	expect(identity.host.sandbox.runSlots).toBeGreaterThan(0);
	expect(identity.host).not.toHaveProperty('name');
	expect(text).not.toContain(`"${hostname()}"`);
});

test('sandbox sizing is recorded with the host; keys, endpoints and paths by any name are not recorded', () => {
	const captured = capturedEnv({
		RECODER_SANDBOX_RUNS: '4',
		RECODER_OBLIGATION_CAP: '3',
		RECODER_GH_TOKEN: 'x',
		RECODER_CACHE_PATH: '/home/someone',
		RECODER_MIRROR_URL: 'https://example.com',
		RECODER_WORKDIR: '/tmp/work',
		HOME: '/home/someone'
	});

	expect(captured).toEqual({ flags: { RECODER_OBLIGATION_CAP: '3' }, host: { RECODER_SANDBOX_RUNS: '4' } });
});

test('every RECODER_ variable the server reads is recorded, or listed here as not a flag', () => {
	const glob = new Bun.Glob('**/*.ts');
	const root = join(import.meta.dir, '../../src');
	const read = /\benv(?:\.|\[['"`])(RECODER_[A-Z0-9_]+)/g;
	const names = new Set<string>();

	for (const path of glob.scanSync({ cwd: root }))
		for (const match of readFileSync(join(root, path), 'utf8').matchAll(read)) names.add(match[1]!);

	expect(names.size).toBeGreaterThan(20);

	for (const name of names) {
		const captured = capturedEnv({ [name]: 'set' });
		const recorded = name in captured.flags || name in captured.host;

		expect({ name, recorded: recorded || NOT_A_FLAG.includes(name) }).toEqual({ name, recorded: true });
		expect({ name, both: recorded && NOT_A_FLAG.includes(name) }).toEqual({ name, both: false });
	}
});
