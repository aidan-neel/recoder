import { beforeEach, describe, expect, test } from 'bun:test';
import { DEFAULT_AUTO_REVIEW_SETTINGS, type AutoReviewSettings } from '@recoder/shared';

import { useAutoReview } from '../../src/lib/settings/auto-review-store';
import { autoReviewPayload } from './auto-review-fixture';

/** The fake server's saved settings; `down` makes every request fail as if nothing listens. */
let saved: AutoReviewSettings;
let down: boolean;
let puts: number;

/** Answers after a turn of the event loop, so two saves would overlap if the store let them. */
async function answer(url: URL, init?: RequestInit): Promise<Response> {
	await new Promise((resolve) => setTimeout(resolve, 5));

	if (down) throw new TypeError('Failed to fetch');
	if (url.pathname !== '/api/settings/auto-review') return new Response('{"error":"not found"}', { status: 404 });

	if (init?.method === 'PUT') {
		puts += 1;
		saved = { ...saved, ...(JSON.parse(String(init.body)) as Partial<AutoReviewSettings>) };
	}

	return new Response(JSON.stringify(autoReviewPayload(saved)));
}

beforeEach(() => {
	saved = { ...DEFAULT_AUTO_REVIEW_SETTINGS };
	down = false;
	puts = 0;

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

describe('the ignored paths', () => {
	test('two quick changes to the ignored paths both land', async () => {
		await useAutoReview.getState().load();

		await Promise.all([
			useAutoReview.getState().addIgnoredPath('docs/**'),
			useAutoReview.getState().addIgnoredPath('**/*.md')
		]);

		expect(saved.ignoredPaths).toEqual(['docs/**', '**/*.md']);
	});

	test('a duplicate glob is refused with no request', async () => {
		await useAutoReview.getState().load();
		await useAutoReview.getState().addIgnoredPath('docs/**');

		await expect(useAutoReview.getState().addIgnoredPath('docs/**')).rejects.toThrow('already in the list');

		expect(puts).toBe(1);
		expect(saved.ignoredPaths).toEqual(['docs/**']);
	});

	test('a blank glob is a no-op', async () => {
		await useAutoReview.getState().load();

		await useAutoReview.getState().addIgnoredPath('   ');

		expect(puts).toBe(0);
		expect(saved.ignoredPaths).toEqual([]);
	});
});
