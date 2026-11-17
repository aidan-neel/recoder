import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { readJsonObject } from '../../util/json-file';
import { parseJson } from '../cli-stream';

type Env = Record<string, string | undefined>;

const credentialSchema = z.object({ type: z.enum(['key', 'api']), key: z.string().min(1) });

/**
 * The API key OpenCode keeps for `integration`: its active credential in OpenCode's database (OpenCode 2), or its
 * entry in `auth.json` when the database has no credential table (OpenCode 1). A database that has the table is the
 * only source, so a key signed out there never comes back from an old `auth.json`. Null when there is no key, or
 * when the integration is signed in some other way, such as OAuth.
 */
export function openCodeKey(env: Env, integration: string): string | null {
	const dir = openCodeDataDir(env);
	const database = join(dir, 'opencode.db');
	const stored = existsSync(database) ? databaseCredential(database, integration) : undefined;
	const credential = stored === undefined ? readJsonObject(join(dir, 'auth.json'))[integration] : stored;
	const parsed = credentialSchema.safeParse(credential);

	return parsed.success ? parsed.data.key : null;
}

/** OpenCode's data dir, on macOS too: `$XDG_DATA_HOME/opencode` when that is absolute, else `~/.local/share/opencode`. */
export function openCodeDataDir(env: Env): string {
	const dataHome = env.XDG_DATA_HOME;

	return join(dataHome && isAbsolute(dataHome) ? dataHome : join(env.HOME || homedir(), '.local', 'share'), 'opencode');
}

/**
 * The newest active credential of `integration` in OpenCode's database, opened read-only; null when it has none,
 * and undefined when the database predates the credential table. A row whose `active` is unset is the
 * integration's only one.
 */
function databaseCredential(file: string, integration: string): unknown {
	const db = new Database(file, { readonly: true });

	try {
		const table = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'credential'").get();

		if (!table) return undefined;

		const row = db
			.query<{ value: string }, [string]>(
				'SELECT value FROM credential WHERE integration_id = ? AND coalesce(active, 1) = 1 ORDER BY time_updated DESC LIMIT 1'
			)
			.get(integration);

		return row ? parseJson(row.value) : null;
	} finally {
		db.close();
	}
}
