import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectUpdateMode, type UpdateEnvironment } from '../../src/update/environment';
import type { RunProcess } from '../../src/update/run';
import { makeCheckout } from './fixture';

/** A run that must never happen: managed and binary answers need no subprocess. */
const noRun: RunProcess = () => Promise.reject(new Error('must not run'));

function environment(overrides: Partial<UpdateEnvironment>): UpdateEnvironment {
	return { root: '/nonexistent', managed: false, compiledBinary: false, ...overrides };
}

describe('detectUpdateMode', () => {
	test('shared storage or a container answers managed with a redeploy note', async () => {
		const detected = await detectUpdateMode(environment({ managed: true }), noRun);

		expect(detected.mode).toBe('managed');
		expect(detected.managedNote).toContain('redeploy');
	});

	test('a compiled binary answers binary', async () => {
		expect((await detectUpdateMode(environment({ compiledBinary: true }), noRun)).mode).toBe('binary');
	});

	test('a git checkout answers git', async () => {
		const { root } = await makeCheckout();

		expect((await detectUpdateMode(environment({ root }))).mode).toBe('git');
	});

	test('a source tree that is not a checkout reports as managed, since something else deployed it', async () => {
		const root = await mkdtemp(join(tmpdir(), 'recoder-update-nogit-'));

		const detected = await detectUpdateMode(environment({ root }));

		expect(detected.mode).toBe('managed');
		expect(detected.managedNote).toContain('Redeploy');
	});
});
