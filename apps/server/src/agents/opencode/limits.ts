import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { UsageWindow } from '@recoder/shared';
import { z } from 'zod';
import { readJsonObject } from '../../util/json-file';
import { parseJson } from '../cli-stream';
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
	const key = openCodeGoKey(env);

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

const credentialSchema = z.object({ type: z.enum(['key', 'api']), key: z.string().min(1) });

/**
 * The OpenCode Go API key OpenCode keeps: the active `opencode-go` credential in its database (OpenCode 2), or
 * the `opencode-go` entry of its `auth.json` when the database has no credential table (OpenCode 1). A database
 * that has the table is the only source, so a key signed out there never comes back from an old `auth.json`. Null
 * when there is no key.
 */
function openCodeGoKey(env: Env): string | null {
	const dir = openCodeDataDir(env);
	const database = join(dir, 'opencode.db');
	const stored = existsSync(database) ? databaseCredential(database) : undefined;
	const credential = stored === undefined ? readJsonObject(join(dir, 'auth.json'))[OPENCODE_GO] : stored;
	const parsed = credentialSchema.safeParse(credential);

	return parsed.success ? parsed.data.key : null;
}

/** OpenCode's data dir, on macOS too: `$XDG_DATA_HOME/opencode` when that is absolute, else `~/.local/share/opencode`. */
export function openCodeDataDir(env: Env): string {
	const dataHome = env.XDG_DATA_HOME;

	return join(dataHome && isAbsolute(dataHome) ? dataHome : join(env.HOME || homedir(), '.local', 'share'), 'opencode');
}

/**
 * The newest active `opencode-go` credential in OpenCode's database, opened read-only; null when it has none, and
 * undefined when the database predates the credential table. A row whose `active` is unset is the provider's only one.
 */
function databaseCredential(file: string): unknown {
	const db = new Database(file, { readonly: true });

	try {
		const table = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'credential'").get();

		if (!table) return undefined;

		const row = db
			.query<{ value: string }, [string]>(
				'SELECT value FROM credential WHERE integration_id = ? AND coalesce(active, 1) = 1 ORDER BY time_updated DESC LIMIT 1'
			)
			.get(OPENCODE_GO);

		return row ? parseJson(row.value) : null;
	} finally {
		db.close();
	}
}
