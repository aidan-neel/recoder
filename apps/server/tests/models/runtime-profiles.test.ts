import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { postChat } from '../../src/models/llm/openai-compatible';
import { configForOrchestrator } from '../../src/models/models';
import { sampling } from '../../src/models/runtime-profiles';
import { getStoredSettings, saveReviewSettings, setReviewOverrides } from '../../src/review/session/review-settings';

const originalDataDir = process.env.RECODER_DATA_DIR;
const realFetch = globalThis.fetch;

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-runtime-'));
	setReviewOverrides({});
});

afterEach(() => {
	process.env.RECODER_DATA_DIR = originalDataDir;
	globalThis.fetch = realFetch;
	setReviewOverrides({});
});

const entry = { id: 'm', label: 'M', model: 'z-ai/glm-5.3-flash', baseUrl: 'http://model.test/v1' };

test('a model with no entry settings and no built-in profile samples at temperature 0 with 8000 tokens', () => {
	saveReviewSettings({ models: [{ ...entry, model: 'some-unlisted-model' }] });

	expect(sampling(configForOrchestrator())).toEqual({ temperature: 0, maxTokens: 8000 });
});

test('an entry’s own runtime beats the built-in profile for its model, field by field', () => {
	saveReviewSettings({ models: [{ ...entry, runtime: { temperature: 0.3 } }] });

	expect(sampling(configForOrchestrator())).toEqual({ temperature: 0.3, topP: 0.95, maxTokens: 8000 });
});

test('a profile’s output cap replaces the review default but only lowers another call’s own cap', () => {
	const config = { runtime: { maxOutputTokens: 4000 } };

	expect(sampling(config)).toMatchObject({ maxTokens: 4000 });
	expect(sampling(config, 1200)).toMatchObject({ maxTokens: 1200 });
	expect(sampling(config, 16_000)).toMatchObject({ maxTokens: 4000 });
});

test('a null temperature leaves the field out of the request body', async () => {
	const bodies: Record<string, unknown>[] = [];

	globalThis.fetch = (async (_url, init) => {
		bodies.push(JSON.parse(String(init?.body)));

		return new Response('{}');
	}) as typeof fetch;

	const call = { baseUrl: 'http://model.test/v1', apiKey: '', model: 'm', messages: [] };

	await postChat({ ...call, temperature: null, topP: 0.9 }, new AbortController().signal, false);
	await postChat({ ...call, temperature: 0 }, new AbortController().signal, false);

	expect(bodies[0]).not.toHaveProperty('temperature');
	expect(bodies[0]).toMatchObject({ top_p: 0.9 });
	expect(bodies[1]).toMatchObject({ temperature: 0 });
	expect(bodies[1]).not.toHaveProperty('top_p');
});

test('saving a model without runtime keeps the runtime set earlier, and an empty runtime clears it', () => {
	saveReviewSettings({ models: [{ ...entry, runtime: { temperature: null } }] });
	saveReviewSettings({ models: [entry] });

	expect(getStoredSettings().models?.[0]?.runtime).toEqual({ temperature: null });
	expect(sampling(configForOrchestrator()).temperature).toBeNull();

	saveReviewSettings({ models: [{ ...entry, runtime: {} }] });

	expect(getStoredSettings().models?.[0]).not.toHaveProperty('runtime');
});
