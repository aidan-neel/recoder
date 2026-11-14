import { expect, test } from 'bun:test';
import { codexLimits, readCodexLimits } from '../../../src/agents/codex/limits';
import { LimitsError } from '../../../src/agents/limits-read';
import { fakeRpcCli } from '../../helpers/fake-rpc-cli';

/** One rate-limit bucket in the shape `account/rateLimits/read` of codex-cli 0.167.0 answered on 2026-11-13. */
function bucket(limitId: string, limitName: string | null, primaryUsed: number, secondaryUsed: number) {
	return {
		limitId,
		limitName,
		normalModelSlug: null,
		primary: { usedPercent: primaryUsed, windowDurationMins: 300, resetsAt: 1794598517 },
		secondary: { usedPercent: secondaryUsed, windowDurationMins: 10080, resetsAt: 1794651398 },
		credits: { hasCredits: false, unlimited: false, balance: '0' },
		individualLimit: null,
		spendControlReached: false,
		planType: 'plus',
		rateLimitReachedType: null
	};
}

const RATE_LIMITS = {
	ordinaryUsageAllowed: true,
	rateLimits: bucket('codex', null, 30, 26),
	rateLimitsByLimitId: { codex: bucket('codex', null, 30, 26), codex_spark: bucket('codex_spark', 'Spark', 4, 101) },
	rateLimitResetCredits: { availableCount: 3, credits: null }
};

const CHATGPT_ACCOUNT = { account: { type: 'chatgpt', email: 'dev@example.com', planType: 'plus' } };

test('the main bucket’s windows come first by length, then each other bucket’s named after it, clamped', () => {
	const reading = codexLimits({ result: CHATGPT_ACCOUNT }, { result: RATE_LIMITS });

	expect(reading).toEqual({
		status: 'ready',
		plan: 'Plus',
		windows: [
			{ label: '5-hour', usedPercent: 30, resetsAt: '2026-11-13T19:35:17.000Z' },
			{ label: 'Weekly', usedPercent: 26, resetsAt: '2026-11-14T10:16:38.000Z' },
			{ label: '5-hour Spark', usedPercent: 4, resetsAt: '2026-11-13T19:35:17.000Z' },
			{ label: 'Weekly Spark', usedPercent: 100, resetsAt: '2026-11-14T10:16:38.000Z' }
		]
	});
});

test('no account is signed out, and an API-key account has no plan windows to read', () => {
	const signedOut = { result: { account: null, requiresOpenaiAuth: true } };
	const apiKey = { result: { account: { type: 'apiKey' } } };

	expect(codexLimits(signedOut, undefined)).toEqual({ status: 'signed-out' });
	expect(codexLimits(apiKey, undefined)).toEqual({ status: 'unsupported' });
});

test('an error reply is a failed read that quotes the CLI with its credentials redacted', () => {
	const failed = { error: { code: -32600, message: 'backend refused Authorization: Bearer sk-live-secret-123' } };

	expect(() => codexLimits({ result: CHATGPT_ACCOUNT }, failed)).toThrow(LimitsError);
	expect(() => codexLimits({ result: CHATGPT_ACCOUNT }, failed)).not.toThrow(/sk-live-secret-123/);
});

test('the reader asks the app-server for the account and its limits over stdio, past lines that are not replies', async () => {
	const env = await fakeRpcCli('codex', {
		initialize: { result: { userAgent: 'codex' } },
		'account/read': { result: CHATGPT_ACCOUNT },
		'account/rateLimits/read': { result: RATE_LIMITS }
	});

	const reading = await readCodexLimits(env);

	expect(reading).toEqual(expect.objectContaining({ status: 'ready', plan: 'Plus' }));
});

test('an app-server that exits without answering is a failed read', async () => {
	const env = await fakeRpcCli('codex', {}, { FAKE_RPC_EXIT: '1' });

	await expect(readCodexLimits(env)).rejects.toThrow('Codex did not report its usage.');
});
