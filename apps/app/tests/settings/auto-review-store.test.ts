import { beforeEach, describe, expect, test } from 'bun:test';
import { DEFAULT_AUTO_REVIEW_SETTINGS, type AutoReviewPayload, type AutoReviewSettings } from '@recoder/shared';

import { useAutoReview } from '../../src/lib/settings/auto-review-store';

/** The fake server's saved settings; `down` makes every request fail as if nothing listens. */
let saved: AutoReviewSettings;
let down: boolean;

function payload(): AutoReviewPayload {
	return {
		settings: saved,
		status: { running: false, watching: 0, lastCheckAt: null, nextCheckAt: null, errors: [], recent: [] },
		webhookPaths: { gitlab: '/api/webhooks/gitlab', github: '/api/webhooks/github' }
	};
}

/** Answers after a turn of the event loop, so two saves would overlap if the store let them. */
async function answer(url: URL, init?: RequestInit): Promise<Response> {
	await new Promise((resolve) => setTimeout(resolve, 5));

	if (down) throw new TypeError('Failed to fetch');
	if (url.pathname !== '/api/settings/auto-review') return new Response('{"error":"not found"}', { status: 404 });
	if (init?.method === 'PUT') saved = { ...saved, ...(JSON.parse(String(init.body)) as Partial<AutoReviewSettings>) };

	return new Response(JSON.stringify(payload()));
}

beforeEach(() => {
	saved = { ...DEFAULT_AUTO_REVIEW_SETTINGS };
	down = false;

	Object.assign(globalThis, {
		fetch: (input: string | URL, init?: RequestInit) => answer(new URL(String(input)), init)
	});

	useAutoReview.setState({ status: 'idle', payload: null, error: null });
});

describe('auto-review store', () => {
	test('two repositories switched off at once both stay off', async () => {
		await useAutoReview.getState().load();

		await Promise.all([useAutoReview.getState().watchRepo('a', false), useAutoReview.getState().watchRepo('b', false)]);

		expect(saved.excludedRepoIds.sort()).toEqual(['a', 'b']);
	});

	test('a refresh that fails keeps the loaded settings on screen', async () => {
		await useAutoReview.getState().load();

		down = true;
		await useAutoReview.getState().load();

		expect(useAutoReview.getState()).toMatchObject({ status: 'ready', payload: { settings: saved } });
	});
});
