import { cliEnv } from '../cli-process';

type Env = Record<string, string | undefined>;

/**
 * Variables the CLI must not inherit from the server: API keys and endpoints that would make it bill an account
 * other than the user's subscription (`ANTHROPIC_*`, `CLAUDE_CODE_*`), the state of a Claude Code session the
 * server runs inside (`CLAUDE_*`, such as its compaction threshold), switches that turn off prompt caching or set
 * the thinking budget, the server's own settings and keys, and any token or secret. The CLI keeps the rest: PATH,
 * HOME, locale, temp and XDG dirs, proxies, and the two dirs that hold its config and sign-in.
 */
const STRIPPED = [
	/^ANTHROPIC_/,
	/^CLAUDE_(?!CONFIG_DIR$|SECURESTORAGE_CONFIG_DIR$)/,
	/^CLAUDECODE/,
	/^(?:DISABLE|ENABLE)_PROMPT_CACHING/,
	/^MAX_THINKING_TOKENS$/,
	/^DISABLE_INTERLEAVED_THINKING$/,
	/^DISABLE_(?:AUTO_)?COMPACT$/,
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
