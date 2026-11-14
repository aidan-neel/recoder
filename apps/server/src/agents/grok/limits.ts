import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { RPC_ERROR } from '../../cli/mcp/json-rpc';
import { emptyDirectory, findCli } from '../cli-process';
import { LimitsError, capitalized, isoTime, parseUsage, usageWindow, type LimitsReading } from '../limits-read';
import { exchangeRpc, type RpcMessage, type RpcReply } from '../limits-rpc';
import { quotedLine } from '../quoted-line';
import { GROK_CLI, grokEnv, prepareHome, realAuthPath } from './grok-process';
import { SIGNED_OUT } from './grok-reply';
import { GROK_EMPTY_DIR } from './grok-run';

type Env = Record<string, string | undefined>;

const PROVIDER = 'Grok Build';

const BILLING_REQUEST = 2;

/** Longest stretch of the CLI's error message quoted in a failed read. */
const QUOTED_CHARS = 120;

/** The ACP handshake, offering the agent no file or terminal access, then xAI's billing extension method. */
const MESSAGES: RpcMessage[] = [
	{
		id: 1,
		method: 'initialize',
		params: {
			protocolVersion: 1,
			clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }
		}
	},
	{ id: BILLING_REQUEST, method: '_x.ai/billing', params: {} }
];

/** The prefix of the billing period's type (`USAGE_PERIOD_TYPE_WEEKLY`), before the part that names it. */
const PERIOD_PREFIX = 'USAGE_PERIOD_TYPE_';

/**
 * Grok Build's credit window, read through the `_x.ai/billing` method of `grok agent stdio`. The CLI runs in an
 * empty home of its own and reads its sign-in in place through `GROK_AUTH_PATH`, as every Recoder call does, so
 * Recoder never reads the credentials.
 */
export async function readGrokLimits(env: Env): Promise<LimitsReading> {
	const path = findCli(GROK_CLI, env);

	if (!path) throw new LimitsError('Grok Build is not installed.');

	const authPath = realAuthPath(env);

	if (!authPath && env.XAI_API_KEY === undefined) return { status: 'signed-out' };

	const home = await mkdtemp(join(tmpdir(), 'recoder-grok-limits-'));

	try {
		prepareHome(home);

		const cwd = await emptyDirectory(GROK_EMPTY_DIR);
		const server = { argv: [path, 'agent', 'stdio'], cwd, env: grokEnv(env, home, authPath), provider: PROVIDER };
		const replies = await exchangeRpc(server, MESSAGES);

		return grokLimits(replies.get(BILLING_REQUEST));
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}

const billingSchema = z.object({
	config: z.object({
		creditUsagePercent: z.number().nullish(),
		currentPeriod: z.object({ type: z.string().nullish(), end: z.string().nullish() }).nullish(),
		billingPeriodEnd: z.string().nullish()
	}),
	subscription_tier: z.string().nullish()
});

/**
 * What the reply to `_x.ai/billing` says: the share of the current period's credits used, named for the period
 * (`Weekly`), and the plan. A CLI too old to have the method reports nothing Recoder can read; a period that
 * reports no share yet has no window.
 */
export function grokLimits(reply: RpcReply | undefined): LimitsReading {
	if (reply?.error?.code === RPC_ERROR.methodNotFound) return { status: 'unsupported' };

	const message = reply?.error?.message ?? '';

	if (reply?.error && SIGNED_OUT.test(message)) return { status: 'signed-out' };
	if (reply?.error) throw new LimitsError(`Grok Build’s usage could not be read: ${quotedLine(message, QUOTED_CHARS)}`);

	const { config, subscription_tier } = parseUsage(billingSchema, reply?.result, PROVIDER);
	const percent = config.creditUsagePercent;
	const resetsAt = isoTime(config.currentPeriod?.end ?? config.billingPeriodEnd);
	const label = periodLabel(config.currentPeriod?.type);

	return {
		status: 'ready',
		plan: subscription_tier || null,
		windows: typeof percent === 'number' ? [usageWindow(label, percent, resetsAt)] : []
	};
}

/** `USAGE_PERIOD_TYPE_WEEKLY` → `Weekly`; a period of no known type is the plan's credits. */
function periodLabel(type: string | null | undefined): string {
	const period = type?.startsWith(PERIOD_PREFIX) ? type.slice(PERIOD_PREFIX.length).toLowerCase() : '';

	return period ? capitalized(period) : 'Credits';
}
