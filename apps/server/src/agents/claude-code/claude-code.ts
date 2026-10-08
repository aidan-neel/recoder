import { rmSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentStatus, ModelEntry } from '@recoder/shared';
import { LlmError, cancelledError, timedOutError } from '../../models/llm/errors';
import { DEFAULT_TIMEOUT_MS, type ChatOptions } from '../../models/llm/types';
import { emptyDirectory, findCli, killGroup, probeVersion, stopOnShutdown } from '../cli-process';
import { promptText, systemText } from '../cli-prompt';
import type { AgentAdapter } from '../registry';
import { claudeCodeEfforts, claudeCodeModels } from './claude-code-models';
import { claudeCodeEnv } from './claude-code-process';
import { ReplyReader } from './claude-code-reply';

type Env = Record<string, string | undefined>;

const INSTALL = 'curl -fsSL https://claude.ai/install.sh | bash';

const LOGIN = 'claude auth login';

const STATUS_TIMEOUT_MS = 10_000;

/**
 * Print mode with everything but the model call turned off: no tools, a permission mode that refuses any tool,
 * one turn, no saved session, and `--safe-mode` so the user's CLAUDE.md, hooks, plugins, skills and MCP servers
 * never load. `stream-json` needs `--verbose` in print mode, and carries the error code of a failed call.
 */
const BASE_ARGS = [
	'-p',
	'--safe-mode',
	'--strict-mcp-config',
	'--disable-slash-commands',
	'--tools',
	'',
	'--permission-mode',
	'dontAsk',
	'--max-turns',
	'1',
	'--no-session-persistence',
	'--output-format',
	'stream-json',
	'--verbose',
	'--include-partial-messages'
];

/**
 * The effort flags for a model that takes levels. `thinking: false` turns thinking off; the CLI has no
 * temperature, top-p, seed or output cap, so those are not sent.
 */
function effortArgs({ model, reasoningEffort, thinking }: ChatOptions): string[] {
	if (thinking === false) return ['--thinking', 'disabled'];

	const offered = claudeCodeEfforts(model).efforts;

	return reasoningEffort && offered?.includes(reasoningEffort) ? ['--effort', reasoningEffort] : [];
}

/** Hand each complete line of a stream to `onLine`, the last one included. */
async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
	const decoder = new TextDecoder();
	let buffer = '';

	for await (const chunk of stream) {
		buffer += decoder.decode(chunk, { stream: true });

		const lines = buffer.split('\n');

		buffer = lines.pop() ?? '';
		for (const line of lines) if (line.trim()) onLine(line);
	}

	if (buffer.trim()) onLine(buffer);
}

/**
 * Claude Code, run as one `claude -p` process per model call.
 *
 * The CLI signs in with the user's own subscription. Recoder never reads its
 * credential files and never calls the Anthropic API with its token; it only
 * runs the CLI, without the server's keys in its environment, and reads what
 * the CLI prints.
 */
export class ClaudeCodeAgent implements AgentAdapter {
	readonly id = 'claude-code';
	readonly name = 'Claude Code';
	private status: AgentStatus | null = null;
	private running = new Set<Bun.Subprocess>();
	private scratch = new Set<string>();
	private apiKeySource: string | null = null;

	constructor(private readonly env: Env = process.env) {}

	/**
	 * Installed, version, and sign-in from `claude auth status`, which makes no model call, with what paid for the
	 * latest call. Cached until `refresh`.
	 */
	async detect(refresh = false): Promise<AgentStatus> {
		if (this.status && !refresh) return this.status;

		const path = this.find();

		const base: AgentStatus = {
			id: this.id,
			name: this.name,
			installed: !!path,
			version: null,
			path,
			error: null,
			install: INSTALL,
			signedIn: null,
			login: LOGIN,
			providers: false,
			authMethod: null,
			apiKeySource: this.apiKeySource
		};

		if (!path) return (this.status = base);

		try {
			base.version = await probeVersion(path, claudeCodeEnv(this.env));
			if (!base.version) base.error = 'Claude Code did not report a version.';
		} catch {
			base.error = 'Claude Code could not be run.';
		}

		if (!base.error) Object.assign(base, await this.signIn(path));

		return (this.status = base);
	}

	async models(): Promise<ModelEntry[]> {
		return claudeCodeModels();
	}

	/**
	 * One model call. The prompt goes in on stdin and the system prompt in a file, since a review's diff can
	 * pass the kernel's per-argument limit. Text streams to `onToken`; usage comes from the final result line.
	 */
	async complete(opts: ChatOptions, onToken?: (text: string) => void): Promise<string> {
		const path = this.find();

		if (!path) throw new LlmError(0, `Claude Code is not installed. Install it with: ${INSTALL}`);

		const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const timeout = AbortSignal.timeout(timeoutMs);
		const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
		const scratch = await mkdtemp(join(tmpdir(), 'recoder-claude-code-'));
		const systemFile = join(scratch, 'system.md');

		this.scratch.add(scratch);

		try {
			await writeFile(systemFile, systemText(opts), { mode: 0o600 });

			const args = [...BASE_ARGS, '--model', opts.model, ...effortArgs(opts), '--system-prompt-file', systemFile];

			return await this.run(path, args, opts, signal, onToken);
		} catch (error) {
			if (opts.signal?.aborted) throw cancelledError();
			if (timeout.aborted) throw timedOutError(timeoutMs);
			if (error instanceof LlmError) throw error;
			throw new LlmError(0, error instanceof Error ? error.message : 'Claude Code request failed.');
		} finally {
			this.scratch.delete(scratch);
			await rm(scratch, { recursive: true, force: true });
		}
	}

	/** Kill every running call's process group and delete its system prompt file; synchronous, for exit. */
	stop(): void {
		for (const proc of this.running) killGroup(proc);
		for (const dir of this.scratch) rmSync(dir, { recursive: true, force: true });
	}

	private find(): string | null {
		return findCli({ pin: 'RECODER_CLAUDE_BIN', command: 'claude', installed: ['.local', 'bin', 'claude'] }, this.env);
	}

	/**
	 * Spawn the CLI in an empty directory, in its own process group, feed it the prompt and read its reply. When
	 * `signal` aborts the group is killed and the call rejects at once, without waiting for its pipes to close;
	 * whatever the CLI started is killed with it once the call ends either way.
	 */
	private async run(
		path: string,
		args: string[],
		opts: ChatOptions,
		signal: AbortSignal,
		onToken: ((text: string) => void) | undefined
	): Promise<string> {
		const proc = Bun.spawn([path, ...args], {
			cwd: await emptyDirectory('claude-code-empty'),
			env: claudeCodeEnv(this.env),
			detached: true,
			stdin: new Blob([promptText(opts.messages.filter((m) => m.role !== 'system'))]),
			stdout: 'pipe',
			stderr: 'pipe'
		});

		const reader = new ReplyReader({
			onText: onToken,
			onThinking: opts.onReasoning,
			onApiKeySource: (source) => {
				this.apiKeySource = source;
				if (this.status) this.status.apiKeySource = source;
				opts.onApiKeySource?.(source);
			}
		});

		let abort = () => {};

		const stopped = new Promise<never>((_, reject) => {
			abort = () => {
				killGroup(proc);
				reject(cancelledError());
			};
		});

		stopped.catch(() => {});
		this.running.add(proc);
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();

		try {
			const [, stderr, code] = await Promise.race([
				Promise.all([
					readLines(proc.stdout, (line) => reader.line(line)),
					new Response(proc.stderr).text(),
					proc.exited
				]),
				stopped
			]);

			return reader.finish(opts.onUsage, { code, stderr });
		} finally {
			signal.removeEventListener('abort', abort);
			this.running.delete(proc);
			killGroup(proc);
		}
	}

	/** `claude auth status --json` exits 1 when signed out; only its `loggedIn` and `authMethod` fields are read. */
	private async signIn(path: string): Promise<Pick<AgentStatus, 'signedIn' | 'authMethod'>> {
		const proc = Bun.spawn([path, 'auth', 'status', '--json'], {
			stdout: 'pipe',
			stderr: 'ignore',
			env: claudeCodeEnv(this.env)
		});

		const timer = setTimeout(() => proc.kill(), STATUS_TIMEOUT_MS);

		try {
			const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
			const { loggedIn, authMethod } = JSON.parse(out) as { loggedIn?: unknown; authMethod?: unknown };

			return {
				signedIn: typeof loggedIn === 'boolean' ? loggedIn : null,
				authMethod: typeof authMethod === 'string' ? authMethod : null
			};
		} catch {
			return { signedIn: null, authMethod: null };
		} finally {
			clearTimeout(timer);
		}
	}
}

export const claudeCode = new ClaudeCodeAgent();

stopOnShutdown('claude-code', () => claudeCode.stop());
