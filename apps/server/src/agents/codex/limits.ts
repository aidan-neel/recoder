import type { UsageWindow } from '@recoder/shared';
import { z } from 'zod';
import { VERSION } from '../../version';
import { emptyDirectory, findCli } from '../cli-process';
import { LimitsError, capitalized, isoFromSeconds, parseUsage, usageWindow, type LimitsReading } from '../limits-read';
import { exchangeRpc, type RpcMessage, type RpcReply } from '../limits-rpc';
import { quotedLine } from '../quoted-line';
import { CODEX_CLI, codexEnv } from './codex-process';

type Env = Record<string, string | undefined>;

const PROVIDER = 'Codex';

const ACCOUNT_REQUEST = 2;

const LIMITS_REQUEST = 3;

/** Longest stretch of the CLI's error message quoted in a failed read. */
const QUOTED_CHARS = 120;

/**
 * The app-server handshake, then the account and its rate limits. Reset-credit details are left out: Settings
 * shows only the windows.
 */
const MESSAGES: RpcMessage[] = [
	{ id: 1, method: 'initialize', params: { clientInfo: { name: 'recoder', version: VERSION } } },
	{ method: 'initialized' },
	{ id: ACCOUNT_REQUEST, method: 'account/read', params: {} },
	{ id: LIMITS_REQUEST, method: 'account/rateLimits/read', params: { excludeResetCreditDetails: true } }
];

/** Windows Codex reports by length in minutes, named as its `/status` names them. */
const NAMED_WINDOWS: Record<number, string> = { 1440: 'Daily', 10080: 'Weekly', 43200: 'Monthly' };

const MINUTES_PER_DAY = 1440;

const MINUTES_PER_HOUR = 60;

/**
 * Codex's plan windows, read through `codex app-server`'s `account/read` and `account/rateLimits/read`: the CLI
 * keeps its sign-in and makes the call, so Recoder never reads its credentials.
 */
export async function readCodexLimits(env: Env): Promise<LimitsReading> {
	const path = findCli(CODEX_CLI, env);

	if (!path) throw new LimitsError('Codex is not installed.');

	const cwd = await emptyDirectory('codex-empty');

	const replies = await exchangeRpc(
		{ argv: [path, 'app-server'], cwd, env: codexEnv(env), provider: PROVIDER },
		MESSAGES
	);

	return codexLimits(replies.get(ACCOUNT_REQUEST), replies.get(LIMITS_REQUEST));
}

const accountSchema = z.object({
	account: z.object({ type: z.string(), planType: z.string().nullish() }).nullable()
});

const windowSchema = z.object({
	usedPercent: z.number(),
	windowDurationMins: z.number().nullish(),
	resetsAt: z.number().nullish()
});

const bucketSchema = z.object({
	limitId: z.string().nullish(),
	limitName: z.string().nullish(),
	planType: z.string().nullish(),
	primary: windowSchema.nullish(),
	secondary: windowSchema.nullish()
});

const rateLimitsSchema = z.object({
	rateLimits: bucketSchema,
	rateLimitsByLimitId: z.record(z.string(), bucketSchema).nullish()
});

type Bucket = z.infer<typeof bucketSchema>;

/**
 * What the replies to `account/read` and `account/rateLimits/read` say: signed out when there is no account,
 * unsupported for an account with no plan windows (an API key, Bedrock, Vertex), else the plan's windows. The
 * main bucket's windows come first, unnamed; any other metered bucket's follow, named after it.
 */
export function codexLimits(account: RpcReply | undefined, rateLimits: RpcReply | undefined): LimitsReading {
	const signedIn = parseUsage(accountSchema, result(account), PROVIDER).account;

	if (!signedIn) return { status: 'signed-out' };
	if (signedIn.type !== 'chatgpt') return { status: 'unsupported' };

	const limits = parseUsage(rateLimitsSchema, result(rateLimits), PROVIDER);
	const main = limits.rateLimits;
	const others = Object.values(limits.rateLimitsByLimitId ?? {}).filter((bucket) => bucket.limitId !== main.limitId);

	return {
		status: 'ready',
		plan: planName(main.planType ?? signedIn.planType),
		windows: [
			...bucketWindows(main, null),
			...others.flatMap((bucket) => bucketWindows(bucket, bucket.limitName ?? bucket.limitId ?? null))
		]
	};
}

/** A reply's result, or a {@link LimitsError} quoting the CLI's error. */
function result(reply: RpcReply | undefined): unknown {
	if (reply?.error) {
		throw new LimitsError(`Codex’s usage could not be read: ${quotedLine(reply.error.message ?? '', QUOTED_CHARS)}`);
	}

	return reply?.result;
}

function bucketWindows(bucket: Bucket, name: string | null): UsageWindow[] {
	return [bucket.primary, bucket.secondary].flatMap((window) => {
		if (!window) return [];

		const label = [durationLabel(window.windowDurationMins), name].filter(Boolean).join(' ');

		return [usageWindow(label, window.usedPercent, isoFromSeconds(window.resetsAt))];
	});
}

/** `300` → `5-hour`, `10080` → `Weekly`; a window of unknown length is a plain rate limit. */
function durationLabel(minutes: number | null | undefined): string {
	if (!minutes) return 'Rate limit';

	const named = NAMED_WINDOWS[minutes];

	if (named) return named;
	if (minutes % MINUTES_PER_DAY === 0) return `${minutes / MINUTES_PER_DAY}-day`;
	if (minutes % MINUTES_PER_HOUR === 0) return `${minutes / MINUTES_PER_HOUR}-hour`;

	return `${minutes}-minute`;
}

/** `plus` → `Plus`, `self_serve_business_prolite` → `Self Serve Business Prolite`; `unknown` → null. */
function planName(planType: string | null | undefined): string | null {
	if (!planType || planType === 'unknown') return null;

	return planType.split('_').map(capitalized).join(' ');
}
