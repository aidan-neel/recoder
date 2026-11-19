import { afterEach, expect, test } from 'bun:test';
import type { ServerCheck } from '@recoder/shared';
import { readServerChecks, startServerChecks } from '../../../src/deploy/diagnostics/checks';
import { updateDeploymentState } from '../../../src/deploy/setup/state';
import { collection } from '../../../src/storage/backend';
import { whenFound } from '../../helpers/when-found';

afterEach(async () => {
	await collection('update_state').clear();
});

test('an abandoned run stops polling, and its late result cannot replace the next run', async () => {
	const oldModel = Promise.withResolvers<ServerCheck>();

	await startServerChecks(() => oldModel.promise, 'model');

	await updateDeploymentState((state) => ({
		...state,
		checkLease: state.checkLease && { ...state.checkLease, expiresAt: 0 }
	}));

	const expired = await readServerChecks();

	expect(expired.running).toBe(false);
	expect(expired.checks.find(({ id }) => id === 'model')?.state).toBe('fail');
	expect(expired.checks.find(({ id }) => id === 'database')?.state).toBe('pending');

	await startServerChecks(async (id) => ({ id, state: 'ok', detail: 'New result.' }), 'model');

	const next = await whenFound(async () => {
		const checks = await readServerChecks();

		return checks.running ? null : checks;
	});

	oldModel.resolve({ id: 'model', state: 'warn', detail: 'Late result.' });
	await new Promise<void>((resolve) => setImmediate(resolve));

	expect(next.checks.find(({ id }) => id === 'model')?.detail).toBe('New result.');
	expect(await readServerChecks()).toEqual(next);
});
