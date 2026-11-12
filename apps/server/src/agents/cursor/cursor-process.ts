import { existsSync, symlinkSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { cliEnv } from '../cli-process';
import type { ToolLease } from '../tools/mcp-host';

type Env = Record<string, string | undefined>;

/**
 * Variables the CLI must not inherit from the server: the server's own settings and keys, `CURSOR_*` overrides of
 * the config and data dirs Recoder sets itself and of the endpoint it would call, other providers' keys, and any
 * token or secret. `CURSOR_API_KEY` and `CURSOR_AUTH_TOKEN` stay: they are the CLI's documented headless sign-in,
 * and the CLI manages them itself. The CLI keeps the rest: PATH, HOME, locale, temp and XDG dirs, proxies.
 */
const STRIPPED = [
	/^RECODER_/,
	/^CURSOR_(?!API_KEY$|AUTH_TOKEN$)/,
	/^OPENAI_/,
	/^ANTHROPIC_/,
	/^GH_TOKEN$/,
	/^GITHUB_TOKEN$/,
	/^(?!CURSOR_).*_TOKEN$/,
	/^(?!CURSOR_).*_API_KEY$/,
	/^(?!CURSOR_).*SECRET/,
	/^(?!CURSOR_).*PASSWORD/
];

/**
 * The CLI's own tools, by the names its permission rules take (`Shell`, `Read`, `Write`, `WebFetch` — the only
 * kinds the permissions reference documents). Deny wins over allow, and `allowlist` mode rejects whatever is
 * neither allowed nor denied when a headless run cannot ask. Search tools (`Grep`, `Glob`, `ListDir`) have no
 * documented permission kind: they run only inside the empty working directory the call gets.
 */
const BUILT_IN_DENIES = [
	'Shell(*)',
	'Shell(**)',
	'Read(**)',
	'Read(/**)',
	'Write(**)',
	'Write(/**)',
	'WebFetch(*)',
	'WebFetch(**)'
];

/** The environment the CLI runs with: the server's, less its keys and Cursor overrides. */
export function cursorEnv(env: Env): Record<string, string> {
	return cliEnv(env, STRIPPED);
}

/**
 * The `cli-config.json` a call runs under, in the fresh `CURSOR_CONFIG_DIR` Recoder points the CLI at. The user's
 * own config, hooks, rules, plugins, skills, memory and MCP servers live under the real config dir and never load
 * here. Permissions run in `allowlist` mode: only what `allow` names runs without approval, and the CLI's own
 * shell, file, edit and web tools are denied outright; its search tools are read-only inside the empty working
 * directory it runs in. With a lease, only Recoder's MCP server is allowed.
 */
function cliConfig(lease: ToolLease | null): string {
	return JSON.stringify({
		version: 1,
		editor: { vimMode: false },
		approvalMode: 'allowlist',
		permissions: {
			allow: lease ? [`Mcp(${lease.name}:*)`] : [],
			deny: BUILT_IN_DENIES
		}
	});
}

/**
 * The `mcp.json` naming Recoder's leased server, at the global scope of the isolated config dir so it loads
 * without a per-workspace approval a headless run cannot give.
 */
function mcpConfig(lease: ToolLease | null): string | null {
	if (!lease) return null;

	return JSON.stringify({ mcpServers: { [lease.name]: { url: lease.url } } });
}

/**
 * Where the CLI keeps its sign-in, in the order it looks: its own `CURSOR_CONFIG_DIR` override, then the XDG and
 * home defaults on Linux and macOS, then the Windows app-data dir. Only paths that exist are kept, and only
 * absolute ones: a relative override would resolve against the link's directory, not the caller's.
 */
function authCandidates(env: Env): string[] {
	const home = env.HOME ?? homedir();

	const candidates = [
		env.CURSOR_CONFIG_DIR && join(env.CURSOR_CONFIG_DIR, 'auth.json'),
		env.XDG_CONFIG_HOME && join(env.XDG_CONFIG_HOME, 'cursor', 'auth.json'),
		join(home, '.config', 'cursor', 'auth.json'),
		join(home, '.cursor', 'auth.json'),
		env.APPDATA && join(env.APPDATA, 'Cursor', 'auth.json')
	];

	return candidates.filter((path): path is string => !!path && isAbsolute(path) && existsSync(path));
}

/**
 * Links the CLI's sign-in file into the isolated config dir, so a `CURSOR_CONFIG_DIR` that also holds the
 * credentials still finds them. Recoder creates the link and never opens the file: the CLI reads and refreshes
 * its own credential through it exactly as it would in place. Best effort — a filesystem that refuses the link
 * (Windows without developer mode) leaves the CLI to its other sign-in paths, and the call reports signed out.
 */
function linkAuth(env: Env, configDir: string): void {
	const [auth] = authCandidates(env);

	if (!auth) return;

	try {
		symlinkSync(auth, join(configDir, 'auth.json'));
	} catch {
		return;
	}
}

/**
 * Writes what a call's isolated `CURSOR_CONFIG_DIR` needs: the deny-everything `cli-config.json`, the `mcp.json`
 * naming Recoder's server when the run leased one, and a link to the CLI's own sign-in file when one exists. The
 * working directory and data dir are made too.
 */
export async function writeCursorConfig(
	place: { config: string; data: string; cwd: string },
	env: Env,
	lease: ToolLease | null
): Promise<void> {
	await mkdir(place.config, { recursive: true });
	await mkdir(place.data, { recursive: true });
	await mkdir(place.cwd, { recursive: true });

	await Bun.write(join(place.config, 'cli-config.json'), cliConfig(lease));

	const servers = mcpConfig(lease);

	if (servers) await Bun.write(join(place.config, 'mcp.json'), servers);

	linkAuth(env, place.config);
}
