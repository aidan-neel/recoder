import { expect, test } from 'bun:test';
import { app } from '../../src/app';
import { putVllmServer } from '../../src/models/vllm/vllm-store';
import { saveReviewSettings, setConnection } from '../../src/review/session/review-settings';
import { isolateSettings } from '../helpers/settings-env';

isolateSettings();

const ENDPOINT_KEY = 'sk-endpoint-9f8e7d6c5b4a';
const PROVIDER_KEY = 'sk-or-provider-1a2b3c4d5e6f';
const MODEL_KEY = 'sk-model-7a8b9c0d1e2f';
const VLLM_KEY = 'sk-vllm-3a4b5c6d7e8f';

const SECRETS = [ENDPOINT_KEY, PROVIDER_KEY, MODEL_KEY, VLLM_KEY];

/** The text of an answer, so any key or fragment of one in any field shows. */
async function answerText(path: string): Promise<string> {
	const response = await app.request(path);

	expect(response.status).toBe(200);

	return response.text();
}

test('no settings, provider or vLLM answer returns a saved key or any part of one', async () => {
	setConnection('openrouter', PROVIDER_KEY);

	saveReviewSettings({
		apiKey: ENDPOINT_KEY,
		models: [{ id: 'm1', label: 'Mine', model: 'gpt', baseUrl: 'http://localhost:8000/v1', apiKey: MODEL_KEY }]
	});

	putVllmServer({
		id: 'v1',
		baseUrl: 'http://vllm.test:8000/v1',
		apiKey: VLLM_KEY,
		syncedAt: null,
		error: null,
		models: [{ id: 'qwen', contextWindow: 4096, served: true }]
	});

	for (const path of ['/api/settings/models', '/api/settings/providers', '/api/settings/vllm']) {
		const text = await answerText(path);

		for (const secret of SECRETS) {
			expect(text).not.toContain(secret);
			expect(text).not.toContain(secret.slice(-4));
		}
	}

	const settings = JSON.parse(await answerText('/api/settings/models'));
	const providers = JSON.parse(await answerText('/api/settings/providers'));

	expect(settings.apiKeySet).toBe(true);

	expect(providers.find((provider: { id: string }) => provider.id === 'openrouter')).toMatchObject({
		connected: true,
		apiKeySet: true
	});
});
