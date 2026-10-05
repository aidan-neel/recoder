import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { apiFor } from './api/api';
import type { OpenCodeApi } from './api/types';
import { OpenCodeError } from './opencode-error';

type Env = Record<string, string | undefined>;

interface Running {
	url: string;
	password: string;
	proc: Bun.Subprocess;
	/** The routes of the binary's major version, chosen once when it was started. */
	api: OpenCodeApi;
}

/** Options for one JSON call to the managed server. */
export interface ServerRequest {
	method?: string;
	body?: unknown;
	timeoutMs?: number;
	/** The caller's cancellation; an abort rejects with the signal's reason. */
	signal?: AbortSignal;
}

const START_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 20_000;
const VERSION_TIMEOUT_MS = 10_000;

/** `RECODER_OPENCODE_BIN` when set (empty means none), else the binary on PATH, else OpenCode's installer location. */
export function findOpenCode(env: Env = process.env): string | null {
	const pinned = env.RECODER_OPENCODE_BIN;

	if (pinned !== undefined) return pinned && existsSync(pinned) ? pinned : null;

	const onPath = Bun.which('opencode', { PATH: env.PATH ?? '' });

	if (onPath) return onPath;

	const installed = join(env.HOME ?? homedir(), '.opencode', 'bin', 'opencode');

	return existsSync(installed) ? installed : null;
}

/** `1.18.31`, `opencode 1.18.31` or `v1.18.31` → `1.18.31`. */
function parseVersion(output: string): string | null {
	return output.match(/\bv?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\b/)?.[1] ?? null;
}

/** The URL `opencode serve` prints once it's listening. */
function parseListenUrl(line: string): string | null {
	return line.match(/listening on (https?:\/\/[^\s]+)/)?.[1]?.replace(/\/$/, '') ?? null;
}

/** The environment with unset entries dropped, as `Bun.spawn` expects. */
function childEnv(env: Env): Record<string, string> {
	const out: Record<string, string> = {};

	for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v;

	return out;
}

/** Run `opencode --version`. Throws when the binary cannot be run at all. */
export async function probeVersion(path: string, env: Env): Promise<string | null> {
	const proc = Bun.spawn([path, '--version'], { stdout: 'pipe', stderr: 'pipe', env: childEnv(env) });
	const timer = setTimeout(() => proc.kill(), VERSION_TIMEOUT_MS);
	const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

	clearTimeout(timer);

	return parseVersion(out);
}

/** Keep reading a stream in the background so a full pipe never blocks the server. */
function drainQuietly(reader: ReadableStreamDefaultReader<Uint8Array>): void {
	void (async () => {
		try {
			while (!(await reader.read()).done);
		} catch {}
	})();
}

/** Wait for `opencode serve` to print its URL, or fail with the last line it wrote to stderr. */
async function readListenUrl(proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>, timeoutMs: number): Promise<string> {
	const reader = proc.stdout.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	const deadline = setTimeout(() => void reader.cancel(), timeoutMs);

	try {
		for (;;) {
			const { value, done } = await reader.read();

			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			const url = parseListenUrl(buffer);

			if (url) {
				drainQuietly(reader);
				void new Response(proc.stderr).text().catch(() => {});

				return url;
			}
		}
	} finally {
		clearTimeout(deadline);
	}

	const err = (await new Response(proc.stderr).text().catch(() => '')).trim().split('\n').at(-1);

	throw new OpenCodeError(err ? `OpenCode did not start: ${err}` : 'OpenCode did not start.');
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/** OpenCode's own error message from a failed response body, when it gives one. */
function errorMessage(json: unknown): string | null {
	if (typeof json === 'string') return json.slice(0, 300) || null;

	const parsed = z
		.object({
			data: z.object({ message: z.string() }).partial().optional(),
			message: z.string().optional(),
			error: z.unknown().optional()
		})
		.safeParse(json);

	if (!parsed.success) return null;

	return (
		parsed.data.data?.message ??
		parsed.data.message ??
		(typeof parsed.data.error === 'string' ? parsed.data.error : null)
	);
}

/**
 * The headless `opencode serve` process Recoder manages. It listens on
 * loopback behind a password generated per spawn.
 */
export class OpenCodeServer {
	private running: Running | null = null;
	private starting: Promise<Running> | null = null;

	constructor(private readonly env: Env) {}

	/** JSON request to the managed server. Errors carry OpenCode's own message when it gives one. */
	async request(path: string, init: ServerRequest = {}): Promise<unknown> {
		const timeout = AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS);
		const response = await this.send(path, init, init.signal ? AbortSignal.any([init.signal, timeout]) : timeout);
		const text = await response.text();
		const json = text ? safeJson(text) : null;

		if (!response.ok)
			throw new OpenCodeError(
				errorMessage(json) ?? `OpenCode answered HTTP ${response.status}.`,
				response.status >= 500 ? 502 : 400
			);

		return json;
	}

	/** The API of the server's OpenCode version. Starts the server when it is not running. */
	async api(): Promise<OpenCodeApi> {
		return (await this.ensure()).api;
	}

	/** Open the server's event stream (SSE). It stays open until `signal` aborts. */
	async stream(path: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
		const response = await this.send(path, {}, signal);

		if (!response.ok || !response.body) throw new OpenCodeError(`OpenCode answered HTTP ${response.status}.`, 502);

		return response.body;
	}

	/**
	 * One authenticated fetch. A timeout or the caller's abort leaves the
	 * server alone; any other network failure means it went away, so the next
	 * call starts a new one.
	 */
	private async send(path: string, init: ServerRequest, signal: AbortSignal): Promise<Response> {
		const server = await this.ensure();

		try {
			return await fetch(`${server.url}${path}`, {
				method: init.method ?? 'GET',
				headers: {
					authorization: `Basic ${btoa(`opencode:${server.password}`)}`,
					...(init.body !== undefined ? { 'content-type': 'application/json' } : {})
				},
				body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
				signal
			});
		} catch (e) {
			if (init.signal?.aborted) throw init.signal.reason;
			if (e instanceof Error && e.name === 'TimeoutError')
				throw new OpenCodeError('OpenCode took too long to answer.', 504);
			if (signal.aborted) throw signal.reason;
			this.running = null;
			throw new OpenCodeError('Lost the connection to OpenCode. Try again.');
		}
	}

	/** Start `opencode serve` once; later calls share it. */
	ensure(): Promise<Running> {
		if (this.running && this.running.proc.exitCode === null) return Promise.resolve(this.running);
		this.starting ??= this.spawn().finally(() => (this.starting = null));

		return this.starting;
	}

	stop(): void {
		this.running?.proc.kill();
		this.running = null;
	}

	private async spawn(): Promise<Running> {
		const path = findOpenCode(this.env);

		if (!path) throw new OpenCodeError('OpenCode is not installed.', 404);

		const version = await probeVersion(path, this.env).catch(() => null);
		const password = randomBytes(24).toString('base64url');

		const proc = Bun.spawn([path, 'serve', '--hostname', '127.0.0.1', '--port', '0'], {
			stdout: 'pipe',
			stderr: 'pipe',
			env: { ...childEnv(this.env), OPENCODE_SERVER_PASSWORD: password }
		});

		const url = await readListenUrl(proc, START_TIMEOUT_MS).catch((e) => {
			proc.kill();
			throw e;
		});

		this.running = { url, password, proc, api: apiFor(version, this) };

		void proc.exited.then(() => {
			if (this.running?.proc === proc) this.running = null;
		});

		return this.running;
	}
}
