import { cliEnv } from '../cli-process';

type Env = Record<string, string | undefined>;

/**
 * Variables the CLI must not inherit from the server: API keys and endpoints that would make it bill an account
 * other than the user's subscription (`ANTHROPIC_*`, `CLAUDE_CODE_*`), the server's own settings and keys, and
 * any token or secret. The CLI keeps the rest: PATH, HOME, locale, temp and XDG dirs, proxies, CLAUDE_CONFIG_DIR.
 */
const STRIPPED = [
	/^ANTHROPIC_/,
	/^CLAUDE_CODE_/,
	/^CLAUDECODE/,
	/^RECODER_/,
	/^OPENAI_/,
	/^GH_TOKEN$/,
	/^GITHUB_TOKEN$/,
	/_TOKEN$/,
	/_API_KEY$/,
	/SECRET/,
	/PASSWORD/
];

/** The server's environment with every stripped variable and every unset entry removed, as `Bun.spawn` expects. */
export function claudeCodeEnv(env: Env): Record<string, string> {
	return cliEnv(env, STRIPPED);
}
