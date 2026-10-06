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
	const out: Record<string, string> = {};

	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined && !STRIPPED.some((pattern) => pattern.test(key.toUpperCase()))) out[key] = value;
	}

	return out;
}

/**
 * Kill a process spawned with `detached: true` together with everything it started: it leads its own process
 * group, so the negative pid reaches the whole group. A group that is already gone is fine.
 */
export function killGroup(proc: Bun.Subprocess): void {
	try {
		process.kill(-proc.pid, 'SIGKILL');
	} catch {
		proc.kill('SIGKILL');
	}
}

/**
 * Run `stop` when the server exits and on SIGINT and SIGTERM. A signal that has no other listener still ends the
 * process with its usual code, as it would without this one. Registered once per process, since `--hot`
 * re-evaluates the module; the listeners call whichever `stop` is current.
 */
export function stopOnShutdown(stop: () => void): void {
	const hooks = globalThis as { __recoderClaudeCodeStop?: () => void };
	const registered = hooks.__recoderClaudeCodeStop !== undefined;

	hooks.__recoderClaudeCodeStop = stop;

	if (registered) return;

	process.once('exit', () => hooks.__recoderClaudeCodeStop?.());

	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.on(signal, () => {
			hooks.__recoderClaudeCodeStop?.();
			if (process.listenerCount(signal) === 1) process.exit(signal === 'SIGINT' ? 130 : 143);
		});
	}
}
