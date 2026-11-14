import { beforeEach, describe, expect, test } from 'bun:test';
import type { UpdateState, UpdateStatus } from '@recoder/shared';

import { ApiError, NetworkError } from '../../src/lib/api/http';
import type { UpdateApi } from '../../src/lib/api/update';
import { describeUpdate } from '../../src/lib/update/update-line';
import { GIVE_UP_MS, pollDelay, useUpdate } from '../../src/lib/update/update-store';

const WAITING: UpdateStatus['available'] = {
	commits: [{ sha: 'abc1234', subject: 'Fix it' }],
	changes: { server: true, web: true, install: false }
};

function status(state: UpdateState, overrides: Partial<UpdateStatus> = {}): UpdateStatus {
	return { mode: 'git', current: { commit: '1f3a9d6e', branch: 'main' }, available: WAITING, state, ...overrides };
}

/** An updater whose status reads answer from a script, one step per call; a step may be an error. */
function scripted(steps: (UpdateStatus | Error)[], apply: UpdateStatus = status('pausing')): UpdateApi {
	let at = 0;

	return {
		status: async () => {
			const step = steps[Math.min(at++, steps.length - 1)];

			if (step instanceof Error) throw step;

			return step;
		},
		check: async () => status('idle'),
		apply: async () => apply
	};
}

beforeEach(() => {
	useUpdate.setState({ read: 'loading', status: null, phase: 'idle', unreachableSince: null, polls: 0, error: null });
});

describe('update store', () => {
	test('follows an update through its states until it settles as updated', async () => {
		const api = scripted([status('updating'), status('restarting'), status('idle', { available: null })]);

		await useUpdate.getState().apply(api);
		await useUpdate.getState().poll(api, 0);
		expect(useUpdate.getState().phase).toBe('applying');

		await useUpdate.getState().poll(api, 1500);
		await useUpdate.getState().poll(api, 3000);

		expect(useUpdate.getState()).toMatchObject({ phase: 'updated', status: { available: null } });
	});

	test('reads a server that went away mid-restart as restarting and carries on when it returns', async () => {
		const api = scripted([new NetworkError('fetch failed'), new NetworkError('fetch failed'), status('resuming')]);

		await useUpdate.getState().apply(api);
		await useUpdate.getState().poll(api, 10_000);

		const away = useUpdate.getState();

		expect(away).toMatchObject({ phase: 'applying', unreachableSince: 10_000 });

		expect(describeUpdate({ ...away, status: away.status ?? status('idle') })).toMatchObject({
			kind: 'progress',
			steps: [{ stage: 'done' }, { stage: 'done' }, { label: 'Restarting', stage: 'current' }, { stage: 'next' }]
		});

		await useUpdate.getState().poll(api, 12_000);
		await useUpdate.getState().poll(api, 14_000);

		expect(useUpdate.getState()).toMatchObject({ phase: 'applying', unreachableSince: null });
	});

	test('treats a proxy error as the server being away', async () => {
		const api = scripted([new ApiError('Bad gateway', 502)]);

		await useUpdate.getState().apply(api);
		await useUpdate.getState().poll(api, 5000);

		expect(useUpdate.getState()).toMatchObject({ phase: 'applying', unreachableSince: 5000 });
	});

	test('gives up when the server stays away longer than the limit', async () => {
		const api = scripted([new NetworkError('fetch failed')]);

		await useUpdate.getState().apply(api);
		await useUpdate.getState().poll(api, 0);
		await useUpdate.getState().poll(api, GIVE_UP_MS + 1);

		expect(useUpdate.getState().phase).toBe('lost');
	});

	test('stops following when the update fails', async () => {
		const api = scripted([status('failed', { error: 'bun install failed' })]);

		await useUpdate.getState().apply(api);
		await useUpdate.getState().poll(api, 0);

		expect(useUpdate.getState()).toMatchObject({ phase: 'idle', status: { state: 'failed' } });
	});

	test('keeps the refusal when the server will not start the update', async () => {
		const api: UpdateApi = {
			...scripted([]),
			apply: async () => {
				throw new ApiError('Uncommitted changes in the checkout.', 409);
			}
		};

		await useUpdate.getState().apply(api);

		expect(useUpdate.getState()).toMatchObject({ phase: 'idle', error: expect.stringContaining('Uncommitted') });
	});

	test('follows an update already running when the page opens', async () => {
		await useUpdate.getState().load(scripted([status('updating')]));

		expect(useUpdate.getState()).toMatchObject({ read: 'ready', phase: 'applying' });
	});
});

describe('poll delay', () => {
	test('is steady while the server answers and grows, capped, while it is away', () => {
		expect(pollDelay(null, 50_000)).toBe(1500);
		expect(pollDelay(0, 4000)).toBe(2500);
		expect(pollDelay(0, GIVE_UP_MS)).toBe(6000);
	});
});
