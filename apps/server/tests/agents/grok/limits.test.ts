import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grokLimits, readGrokLimits } from '../../../src/agents/grok/limits';
import { fakeRpcCli } from '../../helpers/fake-rpc-cli';

/** The result `_x.ai/billing` of grok 1.0.77 answered on 2026-11-13, with other values. */
const BILLING = {
	config: {
		creditUsagePercent: 67.04,
		currentPeriod: {
			type: 'USAGE_PERIOD_TYPE_WEEKLY',
			start: '2026-11-08T17:33:29.151+00:00',
			end: '2026-11-15T17:33:29.151+00:00'
		},
		prepaidBalance: { val: 0 },
		isUnifiedBillingUser: true,
		billingPeriodStart: '2026-11-08T17:33:29.151+00:00',
		billingPeriodEnd: '2026-11-15T17:33:29.151+00:00'
	},
	subscription_tier: 'SuperGrok'
};

test('the billing period’s credit share is one window named for the period, with the subscription as the plan', () => {
	expect(grokLimits({ result: BILLING })).toEqual({
		status: 'ready',
		plan: 'SuperGrok',
		windows: [{ label: 'Weekly', usedPercent: 67, resetsAt: '2026-11-15T17:33:29.151Z' }]
	});
});

test('a period that reports no share yet has no window', () => {
	const fresh = { ...BILLING, config: { ...BILLING.config, creditUsagePercent: undefined } };

	expect(grokLimits({ result: fresh })).toEqual({ status: 'ready', plan: 'SuperGrok', windows: [] });
});

test('a CLI without the billing method is unsupported, and a sign-in error is signed out', () => {
	const missing = { error: { code: -32601, message: 'Method not found' } };
	const signedOut = { error: { code: -32000, message: 'Not logged in. Run grok login.' } };

	expect(grokLimits(missing)).toEqual({ status: 'unsupported' });
	expect(grokLimits(signedOut)).toEqual({ status: 'signed-out' });
});

test('with no sign-in file and no API key the reader is signed out without asking the CLI', async () => {
	const home = await mkdtemp(join(tmpdir(), 'grok-limits-home-'));
	const env = await fakeRpcCli('grok', {}, { HOME: home, FAKE_RPC_EXIT: '1' });

	expect(await readGrokLimits(env)).toEqual({ status: 'signed-out' });
});

test('the reader asks `grok agent stdio` for its billing over ACP, the CLI reading the sign-in in place', async () => {
	const home = await mkdtemp(join(tmpdir(), 'grok-limits-home-'));
	const auth = join(home, 'auth.json');

	await writeFile(auth, '{}');

	const env = await fakeRpcCli(
		'grok',
		{ initialize: { result: { protocolVersion: 1 } }, '_x.ai/billing': { result: BILLING } },
		{ HOME: home, GROK_AUTH_PATH: auth }
	);

	expect(await readGrokLimits(env)).toEqual(expect.objectContaining({ status: 'ready', plan: 'SuperGrok' }));
});
