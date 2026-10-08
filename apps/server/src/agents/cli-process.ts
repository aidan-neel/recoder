import { existsSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentStatus } from '@recoder/shared';
import { LlmError, cancelledError, timedOutError } from '../models/llm/errors';
import { DEFAULT_TIMEOUT_MS, type ChatOptions } from '../models/llm/types';
import { serverDataDir } from '../util/data-dir';
import type { AgentAdapter } from './registry';

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

/** The server's environment minus every variable whose upper-cased name matches `stripped`, and every unset entry. */
export function cliEnv(env: Env, stripped: RegExp[]): Record<string, string> {
	const out: Record<string, string> = {};

	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined && !stripped.some((pattern) => pattern.test(key.toUpperCase()))) out[key] = value;
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
export function stopOnShutdown(name: string, stop: () => void): void {
	const hooks = globalThis as { __recoderStops?: Record<string, () => void> };
	const stops = (hooks.__recoderStops ??= {});
	const registered = name in stops;

	stops[name] = stop;

	if (registered) return;

	process.once('exit', () => stops[name]());

	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.on(signal, () => {
			stops[name]();
			if (process.listenerCount(signal) === 1) process.exit(signal === 'SIGINT' ? 130 : 143);
		});
	}
}

/** What a CLI adapter reports before it has run anything: whether it is installed, and how to install and sign in. */
function initialStatus(
	agent: { id: string; name: string; install: string; login: string },
	path: string | null,
	apiKeySource: string | null = null
): AgentStatus {
	return {
		id: agent.id,
		name: agent.name,
		installed: !!path,
		version: null,
		path,
		error: null,
		install: agent.install,
		signedIn: null,
		login: agent.login,
		providers: false,
		authMethod: null,
		apiKeySource
	};
}

/** One call's time budget and caller signal as a single abort signal, and how to word what stopped it. */
export interface CallDeadline {
	signal: AbortSignal;
	/** The error to throw for a failed call: a cancel or the timeout when that stopped it, else the failure itself. */
	failure(error: unknown, fallback: string): LlmError;
}

export function callDeadline(opts: ChatOptions): CallDeadline {
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const timeout = AbortSignal.timeout(timeoutMs);

	return {
		signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
		failure(error, fallback) {
			if (opts.signal?.aborted) return cancelledError();
			if (timeout.aborted) return timedOutError(timeoutMs);
			if (error instanceof LlmError) return error;

			return new LlmError(0, error instanceof Error ? error.message : fallback);
		}
	};
}

/**
 * Kill `proc`'s group the moment `signal` aborts. `stopped` rejects then, so a call can stop waiting on pipes that
 * may never close; `release` detaches the listener once the call is over.
 */
export function killOnAbort(proc: Bun.Subprocess, signal: AbortSignal): { stopped: Promise<never>; release(): void } {
	let abort = () => {};

	const stopped = new Promise<never>((_, reject) => {
		abort = () => {
			killGroup(proc);
			reject(cancelledError());
		};
	});

	stopped.catch(() => {});
	signal.addEventListener('abort', abort, { once: true });
	if (signal.aborted) abort();

	return { stopped, release: () => signal.removeEventListener('abort', abort) };
}

/**
 * What the CLI adapters share: the cached status, the processes and scratch dirs of calls in flight, and the
 * status check that asks for the version and then, if it ran, the sign-in state.
 */
export abstract class CliAgent implements AgentAdapter {
	abstract readonly id: string;
	abstract readonly name: string;
	abstract readonly install: string;
	abstract readonly login: string;
	protected status: AgentStatus | null = null;
	protected running = new Set<Bun.Subprocess>();
	protected scratch = new Set<string>();
	protected apiKeySource: string | null = null;

	constructor(protected readonly env: Env = process.env) {}

	abstract models(): ReturnType<AgentAdapter['models']>;

	protected abstract find(): string | null;

	/** The environment the CLI runs with: the server's, less its keys. */
	protected abstract childEnv(): Record<string, string>;

	/** The sign-in fields of the status, from a check that makes no model call. */
	protected abstract signIn(path: string): Promise<Partial<AgentStatus>>;

	/** Installed, version and sign-in, cached until `refresh`. */
	async detect(refresh = false): Promise<AgentStatus> {
		if (this.status && !refresh) return this.status;

		const path = this.find();
		const base = initialStatus(this, path, this.apiKeySource);

		if (!path) return (this.status = base);

		try {
			base.version = await probeVersion(path, this.childEnv());
			if (!base.version) base.error = `${this.name} did not report a version.`;
		} catch {
			base.error = `${this.name} could not be run.`;
		}

		if (!base.error) Object.assign(base, await this.signIn(path));

		return (this.status = base);
	}

	/** Kill every running call's process group and delete its scratch dir; synchronous, for exit. */
	stop(): void {
		for (const proc of this.running) killGroup(proc);
		for (const dir of this.scratch) rmSync(dir, { recursive: true, force: true });
	}
}
