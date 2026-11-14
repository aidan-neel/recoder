import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeCodeLimits, readClaudeCodeLimits } from '../../../src/agents/claude-code/limits';

const FAKE_TOKEN = 'sk-ant-oat01-fake-token-for-tests';

/** Part of what `GET /api/oauth/usage` answered on 2026-11-13, with other values and fields Recoder does not read. */
const USAGE = {
	five_hour: { utilization: 12.5, resets_at: '2026-11-13T20:00:00.651798+00:00' },
	seven_day: {
		utilization: 78,
		resets_at: '2026-11-16T18:59:59.651798+00:00',
		limit_dollars: null,
		locked_reason: null
	},
	seven_day_oauth_apps: null,
	seven_day_opus: null,
	seven_day_sonnet: { utilization: 104, resets_at: '2026-11-16T18:59:59.651798+00:00' },
	extra_usage: { is_enabled: true, monthly_limit: 500, used_credits: 0, utilization: 0, currency: 'USD' },
	limits: [
		{ kind: 'weekly_all', group: 'weekly', percent: 78, resets_at: '2026-11-16T18:59:59.651798+00:00', scope: null },
		{
			kind: 'weekly_scoped',
			group: 'weekly',
			percent: 36,
			severity: 'normal',
			resets_at: '2026-11-16T18:59:59.651940+00:00',
			scope: { model: { id: null, display_name: 'Fable' }, surface: null },
			is_active: false
		},
		{ kind: 'weekly_scoped', group: 'weekly', percent: 104, scope: { model: { display_name: 'Sonnet' } } },
		{ kind: 'weekly_scoped', group: 'weekly', percent: 78, scope: { model: { display_name: 'All models' } } },
		{
			kind: 'weekly_scoped',
			group: 'weekly',
			percent: 78,
			scope: { model: { id: 'claude-all-models', display_name: 'Claude' } }
		}
	]
};

/** Off macOS the CLI keeps its sign-in only in the file, so a missing file means signed out. */
const offMacOs = test.skipIf(process.platform === 'darwin');

/** On macOS the sign-in may be in the Keychain instead, which Recoder does not read. */
const onMacOs = test.skipIf(process.platform !== 'darwin');

const MAX_20X = { subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' };

/** A config dir holding a sign-in that expires `expiresInMs` from now. */
async function configDir(expiresInMs: number): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'claude-limits-'));
	const claudeAiOauth = { accessToken: FAKE_TOKEN, expiresAt: Date.now() + expiresInMs, ...MAX_20X };

	await writeFile(join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth }));

	return dir;
}

afterEach(() => {
	mock.restore();
});

test('the metered windows come first, then each weekly limit scoped to one model that they did not already name', () => {
	expect(claudeCodeLimits(USAGE, MAX_20X)).toEqual({
		status: 'ready',
		plan: 'Max 20x',
		windows: [
			{ label: '5-hour', usedPercent: 12.5, resetsAt: '2026-11-13T20:00:00.651Z' },
			{ label: 'Weekly', usedPercent: 78, resetsAt: '2026-11-16T18:59:59.651Z' },
			{ label: 'Weekly Sonnet', usedPercent: 100, resetsAt: '2026-11-16T18:59:59.651Z' },
			{ label: 'Weekly Fable', usedPercent: 36, resetsAt: '2026-11-16T18:59:59.651Z' }
		]
	});
});

test('the reader sends the sign-in’s token with the OAuth beta to the usage endpoint', async () => {
	const fetched = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(USAGE));

	const reading = await readClaudeCodeLimits({ CLAUDE_CONFIG_DIR: await configDir(60_000) });
	const [url, init] = fetched.mock.calls[0] ?? [];

	expect(reading).toEqual(expect.objectContaining({ status: 'ready', plan: 'Max 20x' }));
	expect(url).toBe('https://api.anthropic.com/api/oauth/usage');

	expect(init?.headers).toEqual(
		expect.objectContaining({ Authorization: `Bearer ${FAKE_TOKEN}`, 'anthropic-beta': 'oauth-2025-04-20' })
	);
});

test('a refused token is a failed read that never quotes it', async () => {
	spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`bad token ${FAKE_TOKEN}`, { status: 401 }));

	const read = readClaudeCodeLimits({ CLAUDE_CONFIG_DIR: await configDir(60_000) });

	await expect(read).rejects.toThrow('Claude Code did not accept its sign-in (401). Sign in again.');
});

test('an expired sign-in asks for the CLI to renew it without calling the endpoint', async () => {
	const fetched = spyOn(globalThis, 'fetch');

	await expect(readClaudeCodeLimits({ CLAUDE_CONFIG_DIR: await configDir(-1) })).rejects.toThrow('has expired');
	expect(fetched).not.toHaveBeenCalled();
});

offMacOs('no sign-in file is signed out', async () => {
	const empty = await mkdtemp(join(tmpdir(), 'claude-limits-'));

	expect(await readClaudeCodeLimits({ CLAUDE_CONFIG_DIR: empty })).toEqual({ status: 'signed-out' });
});

onMacOs('on macOS, no sign-in file is a failed read that names the Keychain', async () => {
	const empty = await mkdtemp(join(tmpdir(), 'claude-limits-'));

	await expect(readClaudeCodeLimits({ CLAUDE_CONFIG_DIR: empty })).rejects.toThrow('Keychain');
});
