import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { UsageWindow } from '@recoder/shared';
import { z } from 'zod';
import { readJsonObject } from '../../util/json-file';
import {
	LimitsError,
	capitalized,
	fetchUsage,
	isoTime,
	parseUsage,
	usageWindow,
	type LimitsReading
} from '../limits-read';
import { claudeConfigDir } from './claude-code-process';

type Env = Record<string, string | undefined>;

const PROVIDER = 'Claude Code';

/** The endpoint the CLI's own `/usage` reads: the subscription's windows, by the account's OAuth token. */
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

/** The usage endpoint answers only requests that carry this beta. */
const OAUTH_BETA = 'oauth-2025-04-20';

/** The windows the endpoint reports by key, as Settings labels them. */
const FIXED_WINDOWS = [
	['five_hour', '5-hour'],
	['seven_day', 'Weekly'],
	['seven_day_opus', 'Weekly Opus'],
	['seven_day_sonnet', 'Weekly Sonnet']
] as const;

const credentialsSchema = z.object({
	claudeAiOauth: z.object({
		accessToken: z.string().min(1),
		expiresAt: z.number().nullish(),
		subscriptionType: z.string().nullish(),
		rateLimitTier: z.string().nullish()
	})
});

type Account = Pick<z.infer<typeof credentialsSchema>['claudeAiOauth'], 'subscriptionType' | 'rateLimitTier'>;

/**
 * The Claude subscription's windows. The CLI has no command that prints them, so this is the one place Recoder
 * reads the CLI's sign-in: the OAuth token in `.credentials.json` of its config dir, sent only to Anthropic's usage
 * endpoint, never logged or returned. On macOS the CLI keeps its sign-in in the Keychain unless it was made over
 * SSH; Recoder does not read the Keychain, since a read there asks the person to allow it.
 */
export async function readClaudeCodeLimits(env: Env): Promise<LimitsReading> {
	const file = join(claudeConfigDir(env), '.credentials.json');

	if (!existsSync(file) && process.platform === 'darwin') {
		throw new LimitsError('On macOS, Claude Code keeps its sign-in in the Keychain, which Recoder does not read.');
	}

	const credentials = credentialsSchema.safeParse(readJsonObject(file));

	if (!credentials.success) return { status: 'signed-out' };

	const { accessToken, expiresAt, ...account } = credentials.data.claudeAiOauth;

	if (expiresAt && expiresAt <= Date.now()) {
		throw new LimitsError('Claude Code’s sign-in has expired. Run `claude` once to renew it.');
	}

	const headers = { Authorization: `Bearer ${accessToken}`, 'anthropic-beta': OAUTH_BETA };

	return claudeCodeLimits(await fetchUsage(USAGE_URL, headers, PROVIDER), account);
}

const windowSchema = z.object({ utilization: z.number().nullish(), resets_at: z.string().nullish() }).nullish();

const scopedLimitSchema = z.object({
	kind: z.string().nullish(),
	percent: z.number().nullish(),
	resets_at: z.string().nullish(),
	scope: z
		.object({ model: z.object({ id: z.string().nullish(), display_name: z.string().nullish() }).nullish() })
		.nullish()
});

/** A model scope's name or id that spans every model: `All models`, `claude-all-models`. */
const ALL_MODELS = /(^|[^a-z0-9])all[^a-z0-9]+models$/i;

const usageSchema = z.object({
	five_hour: windowSchema,
	seven_day: windowSchema,
	seven_day_opus: windowSchema,
	seven_day_sonnet: windowSchema,
	limits: z.array(scopedLimitSchema).nullish()
});

/**
 * What the usage endpoint says: the five-hour and weekly windows, the weekly Opus and Sonnet ones when the plan
 * meters them, then each weekly limit scoped to one model (`Weekly Fable`) that those did not already name. A window
 * the account does not meter right now comes back null and is left out. The plan comes from the sign-in.
 */
export function claudeCodeLimits(raw: unknown, account: Account): LimitsReading {
	const usage = parseUsage(usageSchema, raw, PROVIDER);
	const windows: UsageWindow[] = [];

	for (const [key, label] of FIXED_WINDOWS) {
		const utilization = usage[key]?.utilization;

		if (typeof utilization === 'number') windows.push(usageWindow(label, utilization, isoTime(usage[key]?.resets_at)));
	}

	for (const limit of usage.limits ?? []) {
		const model = limit.scope?.model;
		const name = model?.display_name?.trim();
		const label = `Weekly ${name}`;

		if (limit.kind !== 'weekly_scoped' || !name || typeof limit.percent !== 'number') continue;
		if (spansAllModels(name, model?.id)) continue;

		if (!windows.some((window) => window.label === label)) {
			windows.push(usageWindow(label, limit.percent, isoTime(limit.resets_at)));
		}
	}

	return { status: 'ready', plan: planName(account), windows };
}

/** A weekly limit scoped to every model repeats the plain weekly window, so it is left out, as CodexBar does. */
function spansAllModels(...names: (string | null | undefined)[]): boolean {
	return names.some((name) => name && ALL_MODELS.test(name.trim()));
}

/** `max` on tier `default_claude_max_20x` → `Max 20x`, `pro` → `Pro`; null when the sign-in names no plan. */
function planName({ subscriptionType, rateLimitTier }: Account): string | null {
	if (!subscriptionType) return null;

	const multiplier = rateLimitTier?.match(/_(\d+x)$/)?.[1];

	return multiplier ? `${capitalized(subscriptionType)} ${multiplier}` : capitalized(subscriptionType);
}
