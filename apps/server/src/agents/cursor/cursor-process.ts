import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
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
 * kinds the permissions reference documents, https://cursor.com/docs/cli/reference/permissions). Deny wins over
 * allow, and `allowlist` mode rejects whatever is neither allowed nor denied when a headless run cannot ask. The
 * search tools (`Grep`, `Glob`, `ListDir`) have no permission token: `sandbox.readBoundary` in the generated
 * config is what bounds the agent's file reads and searches — outside the workspace they need an approval a
 * headless run cannot give (https://cursor.com/docs/agent/security/run-modes, "Read access", Cursor 3.23+). The
 * boundary's documented extras, the project's `~/.cursor/projects` folder and the `~/.cursor` skills, rules and
 * plugins folders, resolve under `CURSOR_DATA_DIR`, the empty scratch dir here. A CLI that predates read access
 * may let a search reach outside the workspace.
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
 * own config never loads here. Permissions run in `allowlist` mode: only what `allow` names runs without
 * approval, the CLI's own shell, file-edit and web tools are denied outright, and `sandbox.readBoundary` keeps
 * its file reads and searches inside the empty working directory it runs in — outside it they would need an
 * approval the run cannot give. With a lease, only Recoder's MCP server is allowed.
 */
function cliConfig(lease: ToolLease | null): string {
	return JSON.stringify({
		version: 1,
		editor: { vimMode: false },
		approvalMode: 'allowlist',
		sandbox: { readBoundary: 'workspace' },
		permissions: {
			allow: lease ? [`Mcp(${lease.name}:*)`] : [],
			deny: BUILT_IN_DENIES
		}
	});
}

/**
 * The `mcp.json` naming Recoder's leased server, at the global scope of the isolated data dir — the CLI reads its
 * user-level `mcp.json` under its data root (`~/.cursor`, moved by `CURSOR_DATA_DIR`), so it loads without a
 * per-workspace approval a headless run cannot give.
 */
function mcpConfig(lease: ToolLease | null): string | null {
	if (!lease) return null;

	return JSON.stringify({ mcpServers: { [lease.name]: { url: lease.url } } });
}

/**
 * Writes what a call's isolated dirs need: the deny-everything `cli-config.json` in `CURSOR_CONFIG_DIR`, the
 * `mcp.json` naming Recoder's server in `CURSOR_DATA_DIR` when the run leased one, and the working directory.
 * The CLI's sign-in is never touched: Recoder does not read, copy or link its credential file, and the CLI
 * keeps it outside both moved dirs — the login keychain on macOS, an `auth.json` under the XDG or app-data path
 * on Linux and Windows — so a call finds the user's sign-in exactly as the user's own CLI does.
 */
export async function writeCursorConfig(
	place: { config: string; data: string; cwd: string },
	lease: ToolLease | null
): Promise<void> {
	await mkdir(place.config, { recursive: true });
	await mkdir(place.data, { recursive: true });
	await mkdir(place.cwd, { recursive: true });

	await Bun.write(join(place.config, 'cli-config.json'), cliConfig(lease));

	const servers = mcpConfig(lease);

	if (servers) await Bun.write(join(place.data, 'mcp.json'), servers);
}
