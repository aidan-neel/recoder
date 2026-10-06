import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { serverDataDir } from '../util/data-dir';

type Env = Record<string, string | undefined>;

const VERSION_TIMEOUT_MS = 10_000;

/** Where to look for an agent CLI: the env var that pins it, its command name and its installer's path under home. */
interface CliLocation {
	pin: string;
	command: string;
	installed: string[];
}

/** The pinned binary when its env var is set (empty means none), else the command on PATH, else the installer path. */
export function findCli({ pin, command, installed }: CliLocation, env: Env): string | null {
	const pinned = env[pin];

	if (pinned !== undefined) return pinned && existsSync(pinned) ? pinned : null;

	const onPath = Bun.which(command, { PATH: env.PATH ?? '' });

	if (onPath) return onPath;

	const fallback = join(env.HOME ?? homedir(), ...installed);

	return existsSync(fallback) ? fallback : null;
}

/** `1.18.31`, `opencode 1.18.31`, `v1.18.31` or `2.1.281 (Claude Code)` → the version. */
function parseVersion(output: string): string | null {
	return output.match(/\bv?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\b/)?.[1] ?? null;
}

/** The environment with unset entries dropped, as `Bun.spawn` expects. */
export function childEnv(env: Env): Record<string, string> {
	const out: Record<string, string> = {};

	for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v;

	return out;
}

/** Run an agent CLI's `--version`. Throws when the binary cannot be run at all. */
export async function probeVersion(path: string, env: Env): Promise<string | null> {
	const proc = Bun.spawn([path, '--version'], { stdout: 'pipe', stderr: 'pipe', env: childEnv(env) });
	const timer = setTimeout(() => proc.kill(), VERSION_TIMEOUT_MS);
	const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

	clearTimeout(timer);

	return parseVersion(out);
}

/**
 * A directory with nothing in it under the data dir, so an agent CLI never
 * sees the user's files or the PR checkout. Agents scope a session's project
 * to the directory they run in.
 */
export async function emptyDirectory(name: string): Promise<string> {
	const dir = join(serverDataDir(), name);

	await mkdir(dir, { recursive: true });

	return dir;
}
