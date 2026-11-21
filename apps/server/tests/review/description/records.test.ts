import { expect, jest, test } from 'bun:test';
import { claimDescription, finishDescription, savedDescription } from '../../../src/review/description/records';
import { useFakeClock } from '../../helpers/fake-clock';

useFakeClock();

const START = Date.UTC(2026, 0, 1);

test('a stale claim is replaced and cannot overwrite its successor', async () => {
	jest.setSystemTime(START);

	const id = crypto.randomUUID();
	const first = await claimDescription(id, 'head', false);

	jest.setSystemTime(START + 180_001);

	const second = await claimDescription(id, 'head', false);

	expect(second.runId).toBeTruthy();
	expect(second.runId).not.toBe(first.runId);
	await finishDescription(id, first.runId!, { status: 'failed', headSha: 'head', error: 'old result' });
	expect(await savedDescription(id, 'head', false)).toEqual(second.state);
});

test('GET waits one minute to retry a failed run', async () => {
	jest.setSystemTime(START);

	const id = crypto.randomUUID();
	const first = await claimDescription(id, 'head', false);
	const failure = { status: 'failed', headSha: 'head', error: 'bad response' } as const;

	await finishDescription(id, first.runId!, failure);
	jest.setSystemTime(START + 59_999);
	expect(await claimDescription(id, 'head', false)).toEqual({ state: failure, runId: null });

	jest.setSystemTime(START + 60_000);

	const retry = await claimDescription(id, 'head', false);

	expect(retry.runId).toBeTruthy();
	expect(retry.state.status).toBe('pending');
});

test('retention evicts old results without evicting active claims', async () => {
	jest.setSystemTime(START);

	const id = crypto.randomUUID();
	const active = await claimDescription(id, 'active', false);

	for (const headSha of ['old', 'recent-1', 'recent-2', 'recent-3']) {
		const claim = await claimDescription(id, headSha, false);

		await finishDescription(id, claim.runId!, { status: 'failed', headSha, error: 'bad response' });
	}

	expect(await savedDescription(id, 'active', false)).toEqual(active.state);
	expect(await savedDescription(id, 'old', false)).toBeUndefined();
	expect(await savedDescription(id, 'recent-1', false)).toMatchObject({ status: 'failed', headSha: 'recent-1' });
});
