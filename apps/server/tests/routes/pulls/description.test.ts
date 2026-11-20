import { afterEach, beforeAll, beforeEach, expect, spyOn, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import type { PullDescriptionState } from '@recoder/shared';
import { getStoredSettings, setReviewOverrides } from '../../../src/review/session/review-settings';
import { db, modelCalls } from '../../../src/store';
import { git } from '../../helpers/git';
import { localApp } from '../../helpers/local-app';
import { localForgeFixture, type LocalForgeFixture } from '../../helpers/local-forge';
import { whenFound } from '../../helpers/when-found';

const settings = getStoredSettings();
const modelUrl = 'http://description-route.test/v1';
const model = { id: 'grok-fixture', label: 'Grok 4.6', effort: 'low' };
let forge: LocalForgeFixture;
let path: string;
let repoId: string;

beforeAll(async () => {
	forge = await localForgeFixture();
});

beforeEach(async () => {
	repoId = crypto.randomUUID();
	await db.repos.set({ ...forge.repo, id: repoId });
	path = `/api/repos/${repoId}/pulls/7/description`;

	setReviewOverrides({
		baseUrl: modelUrl,
		models: [{ id: model.id, label: model.label, model: 'grok-4.6', efforts: ['high', 'low'] }],
		orchestratorModelId: model.id
	});
});

afterEach(async () => {
	setReviewOverrides(settings);
	git(fileURLToPath(forge.repo.url), ['update-ref', 'refs/pull/7/head', forge.pull7Head]);
	await db.repos.delete(repoId);
});

async function read(method: 'GET' | 'POST' = 'GET'): Promise<PullDescriptionState> {
	const res = await localApp.request(path, { method });

	expect(res.status).toBe(200);
	expect(res.headers.get('cache-control')).toBe('no-store');

	return res.json();
}

function completed(headSha: string) {
	return whenFound(async () => {
		const state = await read();

		if (state.status === 'failed') throw new Error(state.error);

		return state.status === 'ready' && state.description.headSha === headSha ? state.description : null;
	});
}

function fakeCompletion() {
	const release = Promise.withResolvers<string>();

	const fetch = spyOn(globalThis, 'fetch');

	fetch.mockImplementation((async (url: RequestInfo | URL) => {
		expect(String(url)).toBe(`${modelUrl}/chat/completions`);

		return Response.json({
			choices: [{ message: { content: await release.promise } }],
			usage: { prompt_tokens: 10, completion_tokens: 2 }
		});
	}) as typeof globalThis.fetch);

	return { fetch, release: release.resolve };
}

function modelReply(summary: string): string {
	return JSON.stringify({ summary, groups: [], notes: [] });
}

test('concurrent GETs share one generation and the route returns its persisted result', async () => {
	const fake = fakeCompletion();

	try {
		const [first, second] = await Promise.all([read(), read()]);

		expect(first).toMatchObject({ status: 'pending', headSha: forge.pull7Head });
		expect(second).toEqual(first);
		expect(await read('POST')).toEqual(first);
		fake.release(modelReply('Makes two loud.'));

		expect(await completed(forge.pull7Head)).toMatchObject({
			model,
			summary: 'Makes two loud.',
			groups: [{ id: 'g1', title: 'Other changes', paths: ['a.ts', 'new.ts'] }]
		});

		expect(fake.fetch).toHaveBeenCalledTimes(1);

		expect(await modelCalls.list()).toContainEqual(
			expect.objectContaining({
				stage: 'description',
				model: 'grok-4.6',
				effort: 'low',
				usage: expect.objectContaining({ inputTokens: 10, outputTokens: 2 })
			})
		);
	} finally {
		fake.release(modelReply('Makes two loud.'));
		fake.fetch.mockRestore();
	}
});

test('a new head generates fresh and POST can regenerate a ready head', async () => {
	const fake = fakeCompletion();

	try {
		fake.release(modelReply('Makes two loud.'));
		expect(await read()).toMatchObject({ status: 'pending', headSha: forge.pull7Head });
		await completed(forge.pull7Head);

		git(fileURLToPath(forge.repo.url), ['update-ref', 'refs/pull/7/head', forge.pull7Commit]);
		expect(await read()).toMatchObject({ status: 'pending', headSha: forge.pull7Commit });
		expect(await completed(forge.pull7Commit)).toMatchObject({ groups: [{ paths: ['a.ts'] }] });

		expect(await read('POST')).toMatchObject({ status: 'pending', headSha: forge.pull7Commit });
		await completed(forge.pull7Commit);
		expect(fake.fetch).toHaveBeenCalledTimes(3);
	} finally {
		fake.fetch.mockRestore();
	}
});

test('a malformed model response is stored as a short failure', async () => {
	const fake = fakeCompletion();

	try {
		fake.release('not JSON');
		expect(await read()).toMatchObject({ status: 'pending', headSha: forge.pull7Head });

		const failure = await whenFound(async () => {
			const state = await read();

			return state.status === 'failed' ? state : null;
		});

		expect(failure).toEqual({
			status: 'failed',
			headSha: forge.pull7Head,
			error: 'The model did not return a valid description.'
		});

		expect(fake.fetch).toHaveBeenCalledTimes(1);
	} finally {
		fake.fetch.mockRestore();
	}
});

test('a pull request with no changed files does not start generation', async () => {
	const fake = fakeCompletion();

	try {
		git(fileURLToPath(forge.repo.url), ['update-ref', 'refs/pull/7/head', forge.squash]);

		expect(await read()).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('no changed files') });
		expect(fake.fetch).not.toHaveBeenCalled();
	} finally {
		fake.release(modelReply('Makes two loud.'));
		fake.fetch.mockRestore();
	}
});
