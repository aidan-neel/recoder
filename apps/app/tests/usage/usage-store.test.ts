import { beforeEach, describe, expect, test } from 'bun:test';
import type { UsageDays } from '@recoder/shared';

import { ApiError, NetworkError } from '../../src/lib/api/http';
import type { UsageApi } from '../../src/lib/api/usage';
import { sampleUsageReport } from '../../src/lib/sample/sample-usage';
import { useUsage } from '../../src/lib/usage/usage-store';

beforeEach(() => {
	useUsage.setState({ status: 'idle', days: 30, report: null, error: null });
});

describe('usage store', () => {
	test('keeps the report for the range it loaded', async () => {
		const api: UsageApi = { report: async (days) => sampleUsageReport(days) };

		await useUsage.getState().load(api, 7);

		expect(useUsage.getState()).toMatchObject({ status: 'ready', days: 7, report: { days: 7 } });
	});

	test('drops a reply for a range the person has already left', async () => {
		const resolvers = new Map<UsageDays, () => void>();

		const api: UsageApi = {
			report: (days) => new Promise((resolve) => resolvers.set(days, () => resolve(sampleUsageReport(days))))
		};

		const slow = useUsage.getState().load(api, 90);
		const fast = useUsage.getState().load(api, 7);

		resolvers.get(7)?.();
		await fast;
		resolvers.get(90)?.();
		await slow;

		expect(useUsage.getState().report?.days).toBe(7);
	});

	test('reports the server’s reason when it answers with an error', async () => {
		const api: UsageApi = {
			report: async () => {
				throw new ApiError('Admins only.', 403);
			}
		};

		await useUsage.getState().load(api, 30);

		expect(useUsage.getState()).toMatchObject({ status: 'error', error: 'Admins only.' });
	});

	test('is offline, with no reason, when the server does not answer', async () => {
		const api: UsageApi = {
			report: async () => {
				throw new NetworkError('down');
			}
		};

		await useUsage.getState().load(api, 30);

		expect(useUsage.getState()).toMatchObject({ status: 'offline', error: null });
	});
});
