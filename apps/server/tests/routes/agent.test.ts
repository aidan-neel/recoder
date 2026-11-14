import { expect, test } from 'bun:test';
import { app } from '../../src/app';

test('the limits route reads a URL-encoded provider key', async () => {
	const response = await app.request('/api/agent/limits/cli%3Acursor');

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ status: 'unsupported' });
});

test('the limits route refuses a key in neither provider form', async () => {
	for (const key of ['claude-code', 'cli%3A', 'muse%3Aclaude']) {
		expect((await app.request(`/api/agent/limits/${key}`)).status).toBe(400);
	}
});
