import type { UsageWindow } from '@recoder/shared';
import { z } from 'zod';
import { openCodeKey } from './opencode-credentials';
import { fetchUsage, isoTime, parseUsage, usageWindow, type LimitsReading } from '../limits-read';

type Env = Record<string, string | undefined>;

const PROVIDER = 'OpenCode Go';

/** OpenCode's id for the OpenCode Go subscription, in its provider list and its credential store. */
export const OPENCODE_GO = 'opencode-go';

/** The subscription's usage endpoint, read with the OpenCode Go API key. */
const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';

/** The windows the endpoint reports by key, as Settings labels them. */
const WINDOWS = [
	['rolling', '5-hour'],
	['weekly', 'Weekly'],
	['monthly', 'Monthly']
] as const;

/**
 * OpenCode Go's windows, from its usage endpoint. The API key is the one OpenCode keeps for the `opencode-go`
 * provider (Settings connects it there), read from OpenCode's own store and sent only to opencode.ai.
 */
export async function readOpenCodeGoLimits(env: Env): Promise<LimitsReading> {
	const key = openCodeKey(env, OPENCODE_GO);

	if (!key) return { status: 'signed-out' };

	return openCodeGoLimits(await fetchUsage(USAGE_URL, { Authorization: `Bearer ${key}` }, PROVIDER));
}

const windowSchema = z.object({ percent: z.number(), resetsAt: z.string().nullish() }).nullish();

const usageSchema = z.object({
	usage: z.object({ rolling: windowSchema, weekly: windowSchema, monthly: windowSchema })
});

/**
 * What the usage endpoint says: the rolling five-hour, weekly and monthly windows, each when the subscription
 * meters it, their shares already in percent. OpenCode Go is one plan, which the endpoint does not name.
 */
export function openCodeGoLimits(raw: unknown): LimitsReading {
	const { usage } = parseUsage(usageSchema, raw, PROVIDER);

	const windows = WINDOWS.flatMap(([key, label]): UsageWindow[] => {
		const window = usage[key];

		return window ? [usageWindow(label, window.percent, isoTime(window.resetsAt))] : [];
	});

	return { status: 'ready', plan: null, windows };
}
