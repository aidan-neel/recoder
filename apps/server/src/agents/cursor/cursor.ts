import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentStatus, ModelEntry, TokenUsage } from '@recoder/shared';
import { LlmError, cancelledError } from '../../models/llm/errors';
import type { ChatOptions } from '../../models/llm/types';
import { CliAgent, callDeadline, findCli, stopOnShutdown } from '../cli-process';
import { promptText, systemText } from '../cli-prompt';
import { CLI_OUTPUT_CAP_BYTES, LineSplitter, streamCli, type CliExit } from '../cli-stream';
import { quotedLine } from '../quoted-line';
import type { AgentModelSettings, AgentRun, AgentRunOptions } from '../contract';
import { parseCursorModels } from './cursor-models';
import { CURSOR_LOGIN, CursorReader, signInState } from './cursor-output';
import { cursorEnv, writeCursorConfig } from './cursor-process';
import { CursorRun } from './cursor-run';

const INSTALL = 'curl -fsSL https://cursor.com/install | bash';

const STATUS_TIMEOUT_MS = 10_000;

const MODELS_TIMEOUT_MS = 20_000;

/** How long a call's process group is given to exit on its own once the `result` event arrives. */
const RESULT_SETTLE_MS = 250;

/** Print mode with structured output and real-time text deltas; the prompt goes in on stdin. */
const PRINT_ARGS = ['-p', '--output-format', 'stream-json', '--stream-partial-output'];

/**
 * Cursor, run as one `cursor-agent -p` process per model call.
 *
 * The CLI signs in itself. Recoder never reads its credential file; it runs the CLI under an isolated
 * `CURSOR_CONFIG_DIR` that denies every built-in tool and loads no user config, hooks, rules, plugins or MCP
 * servers, and reads what the CLI prints. A link to the CLI's own sign-in file keeps its login working without
 * Recoder ever opening it.
 */
export class CursorAgent extends CliAgent {
	readonly id = 'cursor';
	readonly name = 'Cursor';
	readonly install = INSTALL;
	readonly login = CURSOR_LOGIN;
	/** Each call runs one CLI process, so four run at once unless `RECODER_CURSOR_CONCURRENCY` says otherwise. */
	readonly processCeiling = { env: 'RECODER_CURSOR_CONCURRENCY', fallback: 4 };
	readonly signInFix = `Sign in with \`${CURSOR_LOGIN}\`, or pick another model in Recoder settings.`;

	/**
	 * The account's models, from `cursor-agent models`; throws when the CLI is missing or the list is empty. When
	 * `signal` aborts, the CLI process is killed and the call rejects.
	 */
	async models(signal?: AbortSignal): Promise<ModelEntry[]> {
		const path = this.requireCli();

		const { code, stdout, stderr } = await this.output(path, ['models'], MODELS_TIMEOUT_MS, signal);

		if (code !== 0)
			throw new LlmError(
				0,
				`Cursor could not list its models${stderr.trim() ? `: ${quotedLine(stderr.trim().split('\n').at(-1) ?? '', 200)}` : ` (exit ${code})`}.`
			);

		const listed = parseCursorModels(stdout);

		if (!listed.length) throw new LlmError(0, 'Cursor listed no models.');

		return listed;
	}

	/** Cursor names effort inside the model slug, and no effort flag is documented, so a model has none to set. */
	modelSettings(): AgentModelSettings {
		return {};
	}

	/**
	 * One model call with every tool off. The system prompt and the turns go in on stdin ahead of the prompt,
	 * since the CLI has no system-prompt flag; text streams to `onToken` and usage comes from the `result` event.
	 * The chat the call saves lives in the call's scratch config dir and is deleted with it.
	 */
	async complete(opts: ChatOptions, onToken?: (text: string) => void): Promise<string> {
		const path = this.requireCli();

		const deadline = callDeadline(opts);
		const scratch = await mkdtemp(join(tmpdir(), 'recoder-cursor-'));

		const place = {
			config: join(scratch, 'config'),
			data: join(scratch, 'data'),
			cwd: join(scratch, 'work')
		};

		this.scratch.add(scratch);

		try {
			await writeCursorConfig(place, this.env, null);

			const turns = opts.messages.filter((m) => m.role !== 'system');
			const stdin = `${systemText(opts)}\n\n${promptText(turns)}`;

			return await this.call(path, place, stdin, opts.model, deadline.signal, {
				onToken,
				onReasoning: opts.onReasoning,
				onUsage: opts.onUsage,
				onApiKeySource: (source) => {
					this.apiKeySource = source;
					if (this.status) this.status.apiKeySource = source;
					opts.onApiKeySource?.(source);
				}
			});
		} catch (error) {
			throw deadline.failure(error, 'Cursor request failed.');
		} finally {
			this.scratch.delete(scratch);
			await rm(scratch, { recursive: true, force: true });
		}
	}

	/** A run in which Cursor is the agent, with Recoder's tools over MCP. See {@link CursorRun}. */
	async openRun(options: AgentRunOptions): Promise<AgentRun> {
		const path = this.requireCli();

		return CursorRun.open({ path, env: this.env, running: this.running, scratch: this.scratch }, options);
	}

	protected find(): string | null {
		return findCli(
			{ pin: 'RECODER_CURSOR_BIN', command: 'cursor-agent', installed: ['.local', 'bin', 'cursor-agent'] },
			this.env
		);
	}

	protected childEnv(): Record<string, string> {
		return cursorEnv(this.env);
	}

	/**
	 * `cursor-agent status` reports the account's sign-in state; `--format json` is tried first since not every
	 * version documents it, and a CLI that rejects the flag is asked again plainly.
	 */
	protected async signIn(path: string): Promise<Pick<AgentStatus, 'signedIn'>> {
		const json = await this.output(path, ['status', '--format', 'json'], STATUS_TIMEOUT_MS);
		const state = signInState(json.code, json.stdout);

		if (state !== null && json.stdout.trimStart().startsWith('{')) return { signedIn: state };

		const plain = await this.output(path, ['status'], STATUS_TIMEOUT_MS);

		return { signedIn: signInState(plain.code, plain.stdout) };
	}

	/** The CLI's path, or the install hint every entry point throws when it is missing. */
	private requireCli(): string {
		const path = this.find();

		if (!path) throw new LlmError(0, `Cursor is not installed. Install it with: ${INSTALL}`);

		return path;
	}

	/**
	 * One print-mode call in the isolated config dir: streams `stream-json` events through a {@link CursorReader},
	 * stops the process group shortly after the `result` event, and returns the answer. Throws the call's
	 * {@link LlmError} on failure.
	 */
	private async call(
		path: string,
		place: { config: string; data: string; cwd: string },
		stdin: string,
		model: string,
		signal: AbortSignal,
		handlers: {
			onToken?: (text: string) => void;
			onReasoning?: (text: string) => void;
			onUsage?: (usage: TokenUsage) => void;
			onApiKeySource?: (source: string) => void;
		}
	): Promise<string> {
		const finished = new AbortController();
		let settleTimer: ReturnType<typeof setTimeout> | null = null;

		const reader = new CursorReader({
			text: (delta) => handlers.onToken?.(delta),
			reasoning: (delta) => handlers.onReasoning?.(delta),
			result: () => {
				settleTimer = setTimeout(() => finished.abort(), RESULT_SETTLE_MS);
				settleTimer.unref();
			},
			apiKeySource: handlers.onApiKeySource
		});

		const lines = new LineSplitter(reader.line);

		try {
			const exit = await streamCli({
				argv: [path, ...PRINT_ARGS, '--trust', '--workspace', place.cwd, '--model', model],
				cwd: place.cwd,
				env: {
					...cursorEnv(this.env),
					CURSOR_CONFIG_DIR: place.config,
					CURSOR_DATA_DIR: place.data
				},
				stdin,
				signal: AbortSignal.any([signal, finished.signal]),
				maxOutputBytes: CLI_OUTPUT_CAP_BYTES,
				onOutput: lines.push,
				running: this.running,
				name: this.name
			});

			lines.end();

			return this.reply(reader, exit, handlers.onUsage);
		} catch (error) {
			lines.end();

			if (!reader.finished) throw error;

			return this.reply(reader, { code: 0, stderr: '' }, handlers.onUsage);
		} finally {
			if (settleTimer) clearTimeout(settleTimer);
		}
	}

	/** The call's answer, its usage reported, or the failure thrown. */
	private reply(reader: CursorReader, exit: CliExit, onUsage: ((usage: TokenUsage) => void) | undefined): string {
		const failure = reader.failure(exit);

		if (failure) throw failure;

		const reported = reader.usage();

		if (reported) onUsage?.(reported.usage);

		return reader.answer();
	}

	/** Run a short CLI command to its end, killing it after `timeoutMs`, or when `signal` aborts. */
	private async output(
		path: string,
		args: string[],
		timeoutMs: number,
		signal?: AbortSignal
	): Promise<{ code: number; stdout: string; stderr: string }> {
		const proc = Bun.spawn([path, ...args], {
			stdout: 'pipe',
			stderr: 'pipe',
			env: cursorEnv(this.env),
			...(signal ? { signal } : {})
		});

		const timer = setTimeout(() => proc.kill(), timeoutMs);

		try {
			const [stdout, stderr, code] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited
			]);

			if (signal?.aborted) throw cancelledError();

			return { code, stdout, stderr };
		} finally {
			clearTimeout(timer);
		}
	}
}

export const cursor = new CursorAgent();

stopOnShutdown('cursor', () => cursor.stop());
