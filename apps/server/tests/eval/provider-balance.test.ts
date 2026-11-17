import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { billedLines, deepSeekBalance } from '../../src/eval/provider-balance';

/** The shape of `GET https://api.deepseek.com/user/balance`, which gives amounts as strings. */
const BALANCE = {
	is_available: true,
	balance_infos: [
		{ currency: 'CNY', total_balance: '61.00', granted_balance: '0.00', topped_up_balance: '61.00' },
		{ currency: 'USD', total_balance: '8.51', granted_balance: '0.00', topped_up_balance: '8.51' }
	]
};

/** An OpenCode data home whose `auth.json` holds `key` for the DeepSeek integration, or nothing without one. */
async function dataHome(key?: string): Promise<Record<string, string>> {
	const home = await mkdtemp(join(tmpdir(), 'deepseek-balance-'));
	const dir = join(home, 'opencode');

	await mkdir(dir);
	await writeFile(join(dir, 'auth.json'), JSON.stringify(key ? { deepseek: { type: 'api', key } } : {}));

	return { XDG_DATA_HOME: home };
}

afterEach(() => {
	mock.restore();
});

test('the balance is the USD amount DeepSeek reports, read with the key OpenCode keeps', async () => {
	const fetched = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(BALANCE));

	const balance = await deepSeekBalance(await dataHome('ds-key'));

	expect(balance).toBe(8.51);
	expect(fetched.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer ds-key' });
});

test('without a DeepSeek key there is no balance and no request', async () => {
	const fetched = spyOn(globalThis, 'fetch');

	expect(await deepSeekBalance(await dataHome())).toBeNull();
	expect(fetched).not.toHaveBeenCalled();
});

test('a refused balance request fails with its status and without the key', async () => {
	spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unauthorized', { status: 401 }));

	const failure = deepSeekBalance(await dataHome('ds-key'));

	await expect(failure).rejects.toThrow('HTTP 401');
	await expect(failure).rejects.not.toThrow('ds-key');
});

test('the billed cost is the drop in balance, and nothing when either reading is missing', () => {
	expect(billedLines(9.79, 8.51).join('\n')).toContain('Billed by DeepSeek: $1.28');
	expect(billedLines(null, 8.51)).toEqual([]);
});
