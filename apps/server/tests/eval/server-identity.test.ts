import { afterEach, expect, test } from 'bun:test';
import { app } from '../../src/app';
import type { ServerIdentity } from '../../src/eval/server-identity';
import { sourceVersion } from '../../src/eval/source-hash';

const PLANTED = 'sk-planted-identity-test-key';
const saved = { key: process.env.RECODER_REVIEW_API_KEY, strength: process.env.RECODER_TEST_STRENGTH };

afterEach(() => {
	if (saved.key === undefined) delete process.env.RECODER_REVIEW_API_KEY;
	else process.env.RECODER_REVIEW_API_KEY = saved.key;
	if (saved.strength === undefined) delete process.env.RECODER_TEST_STRENGTH;
	else process.env.RECODER_TEST_STRENGTH = saved.strength;
});

test('GET /health/identity reports allowlisted flags, cache versions and tools, never a key', async () => {
	process.env.RECODER_REVIEW_API_KEY = PLANTED;
	process.env.RECODER_TEST_STRENGTH = '1';

	const response = await app.request('/health/identity');
	const text = await response.text();
	const identity = JSON.parse(text) as ServerIdentity;

	expect(response.status).toBe(200);
	expect(text).not.toContain(PLANTED);
	expect(text).not.toContain(process.env.RECODER_DATA_DIR!);
	expect(Object.keys(identity.flags).every((name) => name.startsWith('RECODER_'))).toBe(true);
	expect(identity.flags).not.toHaveProperty('RECODER_REVIEW_API_KEY');
	expect(identity.flags.RECODER_TEST_STRENGTH).toBe('1');
	expect(identity.flags.RECODER_OBLIGATIONS).toBe(process.env.RECODER_OBLIGATIONS ?? 'unset');
	expect(identity.caches.intent).toMatch(/^source:[0-9a-f]{16}$/);
	expect(identity.code).toBe(sourceVersion());
	expect(identity.caches['review-checkpoint']).toMatch(/^v\d+$/);
	expect(identity.tools.bun).toBe(Bun.version);
	expect(identity.tools.opencode).toBe('not installed');
	expect(identity.policy.analysisDeadlineMs).toBeGreaterThan(0);
	expect(identity.host.sandbox.runSlots).toBeGreaterThan(0);
});
