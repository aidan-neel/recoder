import { rmSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
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
 * The user's own config, or just a version when there is none. The CLI reads its org and model from this file;
 * Recoder never writes it, and only ever runs the CLI under a copy in another `XDG_CONFIG_HOME`, which also
 * leaves out the user's MCP servers, rules and skills. Sign-in is not in it.
 */
async function userConfig(env: Env): Promise<Record<string, unknown>> {
	const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config');

	try {
		const parsed: unknown = JSON.parse(await readFile(join(base, 'devin', 'config.json'), 'utf8'));

		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { ...parsed };
	} catch {
		return { version: 1 };
	}

	return { version: 1 };
}

/** The user's config with every tool denied, so a call sees only the prompt Recoder sends. */
async function toolFreeConfig(env: Env): Promise<string> {
	return JSON.stringify({ ...(await userConfig(env)), permissions: { deny: DENIED_TOOLS } });
}

/**
 * The user's config for an agent run: the CLI's own tools denied, and the tools of Recoder's MCP server `server`
 * allowed, so the model reaches the repository only through them.
 */
export async function runConfig(env: Env, server: string | null): Promise<string> {
	const allow = server ? [`mcp__${server}__*`] : [];

	return JSON.stringify({
		...(await userConfig(env)),
		permissions: { allow, deny: server ? BUILT_IN_TOOLS : DENIED_TOOLS }
	});
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
