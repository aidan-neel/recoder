import { expect, test } from 'bun:test';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenCodeAgent } from '../../../../src/agents/opencode/opencode';
import { fakeOpenCode } from '../../../helpers/fake-opencode';
import { fakeOpenCodeV2Script } from '../../../helpers/fake-opencode-v2';

/** An `opencode` 2.x binary at a path of its own, outside PATH. */
async function pinnedV2(): Promise<string> {
	const path = join(await mkdtemp(join(tmpdir(), 'pinned-opencode-')), 'opencode');

	await writeFile(path, fakeOpenCodeV2Script());
	await chmod(path, 0o755);

	return path;
}

test('RECODER_OPENCODE_BIN picks the binary and the API version, whatever is on PATH', async () => {
	const pinned = await pinnedV2();
	const target = new OpenCodeAgent({ ...(await fakeOpenCode()), RECODER_OPENCODE_BIN: pinned });

	try {
		expect((await target.detect()).version).toBe('2.0.6');

		await target.complete({ baseUrl: '', apiKey: '', model: 'openai/m', messages: [{ role: 'user', content: 'hi' }] });

		const log = (await target.request('/test/calls')) as { method: string; path: string }[];

		expect(log.some((call) => call.method === 'POST' && call.path === '/api/session')).toBe(true);
	} finally {
		target.stop();
	}
});

test('an OpenCode 1.x binary is driven through the root routes', async () => {
	const target = new OpenCodeAgent(await fakeOpenCode());

	try {
		await target.complete({ baseUrl: '', apiKey: '', model: 'openai/m', messages: [{ role: 'user', content: 'hi' }] });

		const log = (await target.request('/test/calls')) as { method: string; path: string }[];

		expect(log.some((call) => call.method === 'POST' && call.path === '/session')).toBe(true);
		expect(log.some((call) => call.path.startsWith('/api/'))).toBe(false);
	} finally {
		target.stop();
	}
});
