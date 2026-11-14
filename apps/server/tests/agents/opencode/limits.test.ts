import { Database } from 'bun:sqlite';
import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCodeGoLimits, readOpenCodeGoLimits } from '../../../src/agents/opencode/limits';

/** What `GET https://opencode.ai/zen/go/v1/usage` answered on 2026-11-13, with other values. */
const USAGE = {
	usage: {
		rolling: { status: 'ok', percent: 0, resetsAt: '2026-11-13T20:00:00Z' },
		weekly: { status: 'ok', percent: 12.25, resetsAt: '2026-11-17T00:00:00Z' },
		monthly: { status: 'ok', percent: 42, resetsAt: '2026-12-01T00:00:00Z' }
	}
};

/** An OpenCode data home whose `auth.json` (OpenCode 1) holds `legacyKey` for OpenCode Go. */
async function dataHome(legacyKey: string): Promise<{ home: string; dir: string }> {
	const home = await mkdtemp(join(tmpdir(), 'opencode-limits-'));
	const dir = join(home, 'opencode');

	await mkdir(dir);
	await writeFile(join(dir, 'auth.json'), JSON.stringify({ 'opencode-go': { type: 'api', key: legacyKey } }));

	return { home, dir };
}

/** OpenCode 2's credential table in `dir`, with `rows` of `[integration, active, updated, value]`. */
function credentialTable(dir: string, rows: [string, number | null, number, object][]): void {
	const db = new Database(join(dir, 'opencode.db'));

	db.run(
		'CREATE TABLE credential (id TEXT, integration_id TEXT, label TEXT, value TEXT, active INTEGER, time_updated INTEGER)'
	);

	for (const [integration, active, updated, value] of rows) {
		db.run('INSERT INTO credential (integration_id, active, time_updated, value) VALUES (?, ?, ?, ?)', [
			integration,
			active,
			updated,
			JSON.stringify(value)
		]);
	}

	db.close();
}

/** The bearer key the one usage request was sent with. */
function sentKey(fetched: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>): string | undefined {
	const headers = fetched.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;

	return headers?.Authorization?.replace('Bearer ', '');
}

afterEach(() => {
	mock.restore();
});

test('the rolling, weekly and monthly windows keep their percentages', () => {
	expect(openCodeGoLimits(USAGE)).toEqual({
		status: 'ready',
		plan: null,
		windows: [
			{ label: '5-hour', usedPercent: 0, resetsAt: '2026-11-13T20:00:00.000Z' },
			{ label: 'Weekly', usedPercent: 12.3, resetsAt: '2026-11-17T00:00:00.000Z' },
			{ label: 'Monthly', usedPercent: 42, resetsAt: '2026-12-01T00:00:00.000Z' }
		]
	});
});

test('the key is OpenCode 2’s newest active OpenCode Go credential, never the old auth.json one', async () => {
	const { home, dir } = await dataHome('legacy-key');
	const fetched = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(USAGE));

	credentialTable(dir, [
		['opencode-go', 0, 3, { type: 'key', key: 'switched-off-key' }],
		['opencode-go', 1, 2, { type: 'key', key: 'active-key' }],
		['anthropic', 1, 4, { type: 'key', key: 'other-provider-key' }]
	]);

	expect(await readOpenCodeGoLimits({ XDG_DATA_HOME: home })).toEqual(expect.objectContaining({ status: 'ready' }));
	expect(sentKey(fetched)).toBe('active-key');
});

test('a credential table with no OpenCode Go key is signed out, whatever auth.json still holds', async () => {
	const { home, dir } = await dataHome('legacy-key');
	const fetched = spyOn(globalThis, 'fetch');

	credentialTable(dir, [['anthropic', 1, 1, { type: 'key', key: 'other-provider-key' }]]);

	expect(await readOpenCodeGoLimits({ XDG_DATA_HOME: home })).toEqual({ status: 'signed-out' });
	expect(fetched).not.toHaveBeenCalled();
});

test('without OpenCode 2’s database the key is the auth.json one', async () => {
	const { home } = await dataHome('legacy-key');
	const fetched = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(USAGE));

	await readOpenCodeGoLimits({ XDG_DATA_HOME: home });

	expect(sentKey(fetched)).toBe('legacy-key');
});
