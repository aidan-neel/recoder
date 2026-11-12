import { cliEnv } from '../cli-process';

type Env = Record<string, string | undefined>;

/**
 * Variables the CLI must not inherit from the server: the server's own settings and keys, the CLI's `COPILOT_*`
 * and `GITHUB_COPILOT_*` overrides of the flags Recoder sets (`COPILOT_MODEL`, `COPILOT_ALLOW_ALL`,
 * `GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS`…), and any token or secret. The CLI keeps the rest: PATH, HOME, locale,
 * temp and XDG dirs, proxies.
 */
const STRIPPED = [/^RECODER_/, /^COPILOT_/, /^GITHUB_COPILOT_/, /_TOKEN$/, /_API_KEY$/, /SECRET/, /PASSWORD/];

/**
 * The token variables `copilot login --help` documents for headless sign-in, in its precedence order. They are
 * the user's own sign-in, so they pass through the strip; the CLI manages them itself and Recoder never reads
 * their values. Its stored sign-in lives in the OS credential store or under `COPILOT_HOME`, which Recoder
 * points at an empty scratch dir it deletes after the run.
 */
const AUTH_TOKENS = ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'] as const;

/**
 * Set on every child: auto-update would download a new CLI (and plugin updates) mid-review instead of running
 * the pinned binary, and a resumed session must not switch to the directory it was first recorded in.
 */
const CHILD_SET: Record<string, string> = {
	COPILOT_AUTO_UPDATE: 'false',
	COPILOT_DISABLE_RESUME_AUTO_CD: '1'
};

/** The server's environment with the stripped variables and unset entries removed, the auth tokens kept, plus {@link CHILD_SET}. */
export function copilotEnv(env: Env): Record<string, string> {
	const child = cliEnv(env, STRIPPED);

	for (const name of AUTH_TOKENS) {
		const value = env[name];

		if (value !== undefined) child[name] = value;
	}

	return { ...child, ...CHILD_SET };
}

/**
 * The child's environment with `COPILOT_HOME` at `home`. The CLI keeps its settings, hooks, plugins, skills,
 * custom instructions, MCP servers and saved sessions under `COPILOT_HOME`, so pointing it at an empty scratch
 * dir is what keeps every piece of the user's own configuration out of a run.
 */
export function copilotEnvWithHome(env: Env, home: string): Record<string, string> {
	return { ...copilotEnv(env), COPILOT_HOME: home };
}
