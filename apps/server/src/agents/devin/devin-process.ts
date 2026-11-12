import { rmSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { cliEnv } from '../cli-process';

type Env = Record<string, string | undefined>;

/**
 * Variables the CLI must not inherit from the server: the server's own settings and keys, `DEVIN_*` overrides of
 * the flags Recoder sets, and any token or secret. The CLI keeps the rest: PATH, HOME, locale, temp and XDG
 * dirs, proxies. Its sign-in is a file under the data dir, which Recoder never reads.
 */
const STRIPPED = [
	/^RECODER_/,
	/^DEVIN_/,
	/^OPENAI_/,
	/^ANTHROPIC_/,
	/^GH_TOKEN$/,
	/_TOKEN$/,
	/_API_KEY$/,
	/SECRET/,
	/PASSWORD/
];

/** The CLI's own tools, by the names its permission rules take. A denied tool is refused before it runs. */
const BUILT_IN_TOOLS = ['read', 'edit', 'grep', 'glob', 'exec'];

/** Every tool the CLI has, MCP tools included: what a single model call may use. */
const DENIED_TOOLS = [...BUILT_IN_TOOLS, 'mcp__*'];

export function devinEnv(env: Env): Record<string, string> {
	return cliEnv(env, STRIPPED);
}

/**
 * The parts of the user's config a call needs: the config version, and the org the CLI bills, which it reads from
 * this file. Sign-in is not in it.
 */
const userConfigSchema = z.object({
	version: z.number().optional(),
	devin: z.object({ org_id: z.string().optional() }).optional()
});

/**
 * Where the CLI reads config from besides its own file: other tools' settings (`~/.claude`, `.cursor`…) and the
 * org's cloud settings, which can bring hooks, rules, plugins and MCP servers. A call turns every source off.
 */
const IMPORT_SOURCES = ['cursor', 'windsurf', 'claude', 'opencode', 'zed', 'copilot', 'agents_standard', 'cloud'];

/**
 * The config a call runs under, built from the fields it needs and nothing else. Recoder never writes the user's
 * own file and only runs the CLI under this one, in another `XDG_CONFIG_HOME`, so the user's hooks, MCP servers,
 * rules and skills never load, and no other tool's config is imported.
 */
async function callConfig(env: Env, permissions: { allow?: string[]; deny: string[] }): Promise<string> {
	const user = await userConfig(env);
	const orgId = user.devin?.org_id;

	return JSON.stringify({
		version: user.version ?? 1,
		...(orgId ? { devin: { org_id: orgId } } : {}),
		read_config_from: Object.fromEntries(IMPORT_SOURCES.map((source) => [source, false])),
		permissions
	});
}

/** The fields {@link callConfig} takes from the user's own config; none when it is missing or not JSON. */
async function userConfig(env: Env): Promise<z.infer<typeof userConfigSchema>> {
	const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config');

	try {
		const parsed: unknown = JSON.parse(await readFile(join(base, 'devin', 'config.json'), 'utf8'));

		return userConfigSchema.safeParse(parsed).data ?? {};
	} catch {
		return {};
	}
}

/** A config with every tool denied, so a call sees only the prompt Recoder sends. */
function toolFreeConfig(env: Env): Promise<string> {
	return callConfig(env, { deny: DENIED_TOOLS });
}

/**
 * The config for an agent run: the CLI's own tools denied, and the tools of Recoder's MCP server `server`
 * allowed, so the model reaches the repository only through them.
 */
export function runConfig(env: Env, server: string | null): Promise<string> {
	const allow = server ? [`mcp__${server}__*`] : [];

	return callConfig(env, { allow, deny: server ? BUILT_IN_TOOLS : DENIED_TOOLS });
}

let home: Promise<string> | null = null;

let made: string | null = null;

/** The `XDG_CONFIG_HOME` to run the CLI under: a temp dir holding the tool-free config, made once per process. */
export function toolFreeHome(env: Env): Promise<string> {
	home ??= (async () => {
		const dir = await mkdtemp(join(tmpdir(), 'recoder-devin-config-'));

		made = dir;
		await Bun.write(join(dir, 'devin', 'config.json'), await toolFreeConfig(env));

		return dir;
	})();

	return home;
}

/** Delete the config dir if one was made; synchronous, for exit. */
export function removeToolFreeHome(): void {
	if (made) rmSync(made, { recursive: true, force: true });

	made = null;
	home = null;
}
