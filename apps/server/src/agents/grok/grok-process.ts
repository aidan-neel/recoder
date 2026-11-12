import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cliEnv } from '../cli-process';
import type { ToolLease } from '../tools/mcp-host';

type Env = Record<string, string | undefined>;

/**
 * Variables the CLI must not inherit from the server: the server's own settings and keys, every `GROK_*` override
 * (the adapter sets the ones it needs itself), other providers' keys and endpoints, and any token or secret. The
 * CLI keeps the rest: PATH, locale, temp and XDG dirs, proxies, and `XAI_API_KEY`, which is a documented way to
 * sign the CLI in and is added back below. Its own sign-in is a file under its home, which Recoder never reads.
 */
const STRIPPED = [
	/^RECODER_/,
	/^GROK_/,
	/^OPENAI_/,
	/^ANTHROPIC_/,
	/^GH_TOKEN$/,
	/^GITHUB_TOKEN$/,
	/_TOKEN$/,
	/_API_KEY$/,
	/SECRET/,
	/PASSWORD/
];

/**
 * The other tools' config surfaces the CLI scans by default (Claude and Cursor skills, rules, agents, hooks and
 * MCP servers). Each is turned off by env var; the fake home already keeps their directories out, this is the
 * second wall for a build that resolves them outside `HOME`.
 */
const COMPAT_DISABLED: Record<string, string> = {
	GROK_CLAUDE_AGENTS_ENABLED: 'false',
	GROK_CLAUDE_HOOKS_ENABLED: 'false',
	GROK_CLAUDE_MCPS_ENABLED: 'false',
	GROK_CLAUDE_RULES_ENABLED: 'false',
	GROK_CLAUDE_SKILLS_ENABLED: 'false',
	GROK_CURSOR_AGENTS_ENABLED: 'false',
	GROK_CURSOR_HOOKS_ENABLED: 'false',
	GROK_CURSOR_MCPS_ENABLED: 'false',
	GROK_CURSOR_RULES_ENABLED: 'false',
	GROK_CURSOR_SKILLS_ENABLED: 'false'
};

/**
 * The sign-in file the CLI would read under the user's own home: `GROK_AUTH_PATH` when set, else `auth.json` in
 * `GROK_HOME` or `~/.grok`. Null when there is none, which the CLI reports as signed out. The path is handed to
 * the CLI; its contents are never read.
 */
export function realAuthPath(env: Env): string | null {
	const override = env.GROK_AUTH_PATH;

	if (override) return existsSync(override) ? override : null;

	const home = env.GROK_HOME ?? join(env.HOME ?? homedir(), '.grok');
	const auth = join(home, 'auth.json');

	return existsSync(auth) ? auth : null;
}

/**
 * The environment a Grok call runs with: the server's minus the stripped variables, `HOME` and `GROK_HOME` pointed
 * at the call's own empty home, memory and every compat surface off, and `GROK_AUTH_PATH` naming the user's own
 * sign-in file when there is one, so the CLI reads and refreshes that file in place.
 */
export function grokEnv(env: Env, home: string, authPath: string | null): Record<string, string> {
	const out = cliEnv(env, STRIPPED);

	out.HOME = home;
	out.GROK_HOME = join(home, '.grok');
	out.GROK_MEMORY = '0';
	Object.assign(out, COMPAT_DISABLED);

	if (authPath) out.GROK_AUTH_PATH = authPath;
	if (env.XAI_API_KEY !== undefined) out.XAI_API_KEY = env.XAI_API_KEY;

	return out;
}

/** A TOML basic string. */
function tomlString(value: string): string {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The user-level config every isolated home starts with. The marketplace source the CLI seeds on a fresh home is
 * kept out (it can install plugins, which are trusted under `~/.grok`), and the bundled skills — a fixed set that
 * changes with each release — are hidden by path so no run's system prompt carries them.
 */
function homeConfig(root: string): string {
	return [
		'[marketplace]',
		'official_marketplace_auto_installed = false',
		'',
		'[skills]',
		`ignore = [${tomlString(join(root, '.grok', 'bundled'))}]`,
		''
	].join('\n');
}

/**
 * Prepares `root` as a Grok home: `.grok/config.toml` with the seed above and nothing else. The sign-in file is
 * never copied or linked in; `grokEnv` names the user's own. Synchronous: the status checks need the home before
 * their first spawn.
 */
export function prepareHome(root: string): void {
	const grokDir = join(root, '.grok');

	mkdirSync(grokDir, { recursive: true });
	writeFileSync(join(grokDir, 'config.toml'), homeConfig(root));
}

/**
 * The project-level config of a run's working directory: Recoder's leased MCP server and nothing else. Project
 * files may only carry `mcp_servers`, `plugins`, `permission` and `mcp.max_output_bytes`, so this file can never
 * add hooks, rules or instructions. A run without tools gets no file, so no server is configured at all.
 */
export async function writeLeaseConfig(cwd: string, lease: ToolLease | null): Promise<void> {
	if (!lease) return;

	const dir = join(cwd, '.grok');

	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'config.toml'), `[mcp_servers.${lease.name}]\nurl = ${tomlString(lease.url)}\n`);
}
