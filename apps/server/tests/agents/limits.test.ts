import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderLimitsReader } from '../../src/agents/limits';

const OPENCODE_GO = { kind: 'opencode', id: 'opencode-go' } as const;

const FAKE_KEY = 'sk-opencode-go-fake-key-for-tests';

const USAGE = { usage: { rolling: { status: 'ok', percent: 10, resetsAt: '2026-11-13T20:00:00Z' } } };

/** A reader whose OpenCode data dir holds `content` as its OpenCode Go `auth.json`, or `opencode.db` when given. */
async function readerWith(files: { auth?: string; database?: string }): Promise<ProviderLimitsReader> {
	const home = await mkdtemp(join(tmpdir(), 'limits-'));

	await mkdir(join(home, 'opencode'));
	if (files.auth) await writeFile(join(home, 'opencode', 'auth.json'), files.auth);
	if (files.database) await writeFile(join(home, 'opencode', 'opencode.db'), files.database);

	return new ProviderLimitsReader({ XDG_DATA_HOME: home });
}

const SIGNED_IN = { auth: JSON.stringify({ 'opencode-go': { type: 'api', key: FAKE_KEY } }) };

afterEach(() => {
	mock.restore();
});

test('a provider with no reader is unsupported', async () => {
	const reader = new ProviderLimitsReader({});

	expect(await reader.read({ kind: 'cli', id: 'cursor' })).toEqual({ status: 'unsupported' });
	expect(await reader.read({ kind: 'opencode', id: 'anthropic' })).toEqual({ status: 'unsupported' });
});

test('a read is kept for the next request, and a refresh reads afresh', async () => {
	const fetched = spyOn(globalThis, 'fetch')
		.mockResolvedValueOnce(Response.json(USAGE))
		.mockResolvedValueOnce(Response.json(USAGE));

	const reader = await readerWith(SIGNED_IN);

	const first = await reader.read(OPENCODE_GO);

	await reader.read(OPENCODE_GO);

	expect(fetched).toHaveBeenCalledTimes(1);

	expect(first).toEqual({
		status: 'ready',
		plan: null,
		windows: [{ label: '5-hour', usedPercent: 10, resetsAt: '2026-11-13T20:00:00.000Z' }],
		checkedAt: expect.any(String)
	});

	await reader.read(OPENCODE_GO, true);

	expect(fetched).toHaveBeenCalledTimes(2);
});

test('a request that times out is an error that names the provider and never the key', async () => {
	spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));

	const reading = await (await readerWith(SIGNED_IN)).read(OPENCODE_GO);

	expect(reading).toEqual({ status: 'error', reason: 'OpenCode Go’s usage could not be read: no answer in time.' });
});

test('a refused key is an error that never quotes the key or the body', async () => {
	spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`invalid key ${FAKE_KEY}`, { status: 401 }));

	const reading = await (await readerWith(SIGNED_IN)).read(OPENCODE_GO);

	expect(reading).toEqual({ status: 'error', reason: 'OpenCode Go did not accept its sign-in (401). Sign in again.' });
});

test('a failure no reader foresaw is a plain error, its cause logged', async () => {
	const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
	const reader = await readerWith({ database: 'not a database' });

	expect(await reader.read(OPENCODE_GO)).toEqual({ status: 'error', reason: 'Its usage could not be read.' });
	expect(warn).toHaveBeenCalledTimes(1);
});
