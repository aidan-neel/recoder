import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../../src/app';
import { initVllmServers } from '../../src/models/vllm/vllm-store';
import { setReviewOverrides } from '../../src/review/session/review-settings';
import { fakeVllm } from '../helpers/fake-vllm';

const dataDir = process.env.RECODER_DATA_DIR;

let vllm: ReturnType<typeof fakeVllm>;

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-vllm-routes-'));
	initVllmServers();
	setReviewOverrides({});
	vllm = fakeVllm([{ id: 'qwen', len: 40960 }]);
});

afterEach(() => {
	vllm.restore();
	process.env.RECODER_DATA_DIR = dataDir;
	initVllmServers();
	setReviewOverrides({});
});

async function send(path: string, method: string, body?: unknown): Promise<Response> {
	return app.request(`/api/settings/vllm${path}`, {
		method,
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}

test('connecting lists the server’s models in the settings registry, and disconnecting removes them', async () => {
	const connected = await send('', 'POST', { baseUrl: 'vllm.test:8000', apiKey: 'sk-secret-1234' });

	expect(connected.status).toBe(200);

	const { servers } = await connected.json();

	expect(servers[0]).toMatchObject({ host: 'vllm.test:8000', apiKeyPreview: '••••1234', error: null });

	const settings = await (await app.request('/api/settings/models')).json();

	expect(settings.models).toContainEqual(
		expect.objectContaining({
			model: 'qwen',
			provider: 'openai-compatible',
			contextWindow: 40960,
			source: 'vLLM · vllm.test:8000'
		})
	);

	expect((await send(`/${servers[0].id}`, 'DELETE')).status).toBe(200);

	const after = await (await app.request('/api/settings/models')).json();

	expect(after.models.filter((entry: { model: string }) => entry.model === 'qwen')).toEqual([]);
});

test('an unreachable server is a 502 with the reason, and nothing is saved', async () => {
	vllm.state.down = true;

	const response = await send('', 'POST', { baseUrl: 'vllm.test:8000' });

	expect(response.status).toBe(502);
	expect((await response.json()).error).toContain('vllm.test:8000');
	expect((await (await send('', 'GET')).json()).servers).toEqual([]);
});
