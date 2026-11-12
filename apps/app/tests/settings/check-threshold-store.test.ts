import { beforeEach, describe, expect, test } from 'bun:test';
import { DEFAULT_AUTO_REVIEW_SETTINGS, type AutoReviewSettings } from '@recoder/shared';

import { useAutoReview } from '../../src/lib/settings/auto-review-store';
import { useCheckThresholdStore } from '../../src/lib/settings/check-threshold-store';
import { autoReviewPayload } from './auto-review-fixture';

/** The fake server's saved settings; `refused` makes every save answer an error. */
let saved: AutoReviewSettings;
let refused: boolean;

beforeEach(() => {
	saved = { ...DEFAULT_AUTO_REVIEW_SETTINGS, checkThreshold: 'error' };
	refused = false;

	Object.assign(globalThis, {
		fetch: (input: string | URL, init?: RequestInit) => {
			if (refused) return Promise.resolve(new Response('{"error":"The check is not available."}', { status: 500 }));

			if (init?.method === 'PUT') {
				saved = { ...saved, ...(JSON.parse(String(init.body)) as Partial<AutoReviewSettings>) };
			}

			return Promise.resolve(new Response(JSON.stringify(autoReviewPayload(saved))));
		}
	});

	useAutoReview.setState({ status: 'ready', payload: autoReviewPayload(saved), error: null });
	useCheckThresholdStore.setState({ draft: null, error: null, state: 'idle' });
});

describe('the check threshold', () => {
	test('a refused save puts the check threshold back', async () => {
		refused = true;

		const choosing = useCheckThresholdStore.getState().choose('warning');

		expect(useCheckThresholdStore.getState().draft).toBe('warning');

		await choosing;

		expect(useCheckThresholdStore.getState().draft).toBeNull();
		expect(useCheckThresholdStore.getState().error).not.toBeNull();
		expect(saved.checkThreshold).toBe('error');
	});

	test('a landed save keeps the picked threshold', async () => {
		await useCheckThresholdStore.getState().choose('warning');

		expect(saved.checkThreshold).toBe('warning');
		expect(useCheckThresholdStore.getState()).toMatchObject({ draft: null, error: null });
	});
});
