import { z } from 'zod';
import { openCodeKey } from '../agents/opencode/opencode-credentials';

type Env = Record<string, string | undefined>;

/** OpenCode's id for the DeepSeek platform integration in its credential store. */
const DEEPSEEK = 'deepseek';

const BALANCE_URL = 'https://api.deepseek.com/user/balance';

const BALANCE_TIMEOUT_MS = 10_000;

const balanceSchema = z.object({
	balance_infos: z.array(z.object({ currency: z.string(), total_balance: z.coerce.number() }))
});

/**
 * The DeepSeek account's USD balance, read with the key OpenCode keeps for its `deepseek` integration and sent only
 * to api.deepseek.com. Null when OpenCode has no DeepSeek key or the account holds no USD balance.
 */
export async function deepSeekBalance(env: Env): Promise<number | null> {
	const key = openCodeKey(env, DEEPSEEK);

	if (!key) return null;

	const response = await fetch(BALANCE_URL, {
		headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
		signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS)
	});

	if (!response.ok) throw new Error(`DeepSeek balance request failed with HTTP ${response.status}`);

	const usd = balanceSchema.parse(await response.json()).balance_infos.find((info) => info.currency === 'USD');

	return usd ? usd.total_balance : null;
}

/**
 * The balance before or after a run, or null with a warning when it cannot be read: a benchmark still reports its
 * scores without the billed cost.
 */
export async function balanceOrWarn(env: Env): Promise<number | null> {
	try {
		return await deepSeekBalance(env);
	} catch (error) {
		console.warn(`Could not read the DeepSeek balance: ${error instanceof Error ? error.message : String(error)}`);

		return null;
	}
}

/**
 * What DeepSeek billed between two balance readings. Anything else that used the account in that time counts too,
 * and DeepSeek may post the last calls a little after the run ends.
 */
export function billedLines(before: number | null, after: number | null): string[] {
	if (before === null || after === null) return [];

	return [
		'',
		`Billed by DeepSeek: $${(before - after).toFixed(2)} (balance $${before.toFixed(2)} → $${after.toFixed(2)}; other use of the account in this time counts too)`
	];
}
