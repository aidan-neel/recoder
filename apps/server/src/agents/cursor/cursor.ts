import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentStatus, ModelEntry, TokenUsage } from '@recoder/shared';
import { LlmError, cancelledError } from '../../models/llm/errors';
import type { ChatOptions } from '../../models/llm/types';
import { CliAgent, callDeadline, emptyDirectory, findCli, stopOnShutdown } from '../cli-process';
import { promptText, systemText } from '../cli-prompt';
import type { CliExit } from '../cli-stream';
import { quotedLine } from '../quoted-line';
import type { AgentModelSettings, AgentRun, AgentRunOptions } from '../contract';
import { parseCursorModels } from './cursor-models';
import { CURSOR_LOGIN, CursorReader, signInState } from './cursor-output';
import { PRINT_ARGS, streamPrintCall } from './cursor-print';
import { cursorEnv, writeCursorConfig } from './cursor-process';
import { CursorRun } from './cursor-run';

const INSTALL = 'curl -fsSL https://cursor.com/install | bash';

const STATUS_TIMEOUT_MS = 10_000;

const MODELS_TIMEOUT_MS = 20_000;

/**
 * Cursor, run as one `cursor-agent -p` process per model call.
 *
 * The CLI signs in itself. Recoder never reads, copies or links its credential file; it runs the CLI under
 * isolated `CURSOR_CONFIG_DIR` and `CURSOR_DATA_DIR` dirs that deny its shell, file-edit and web tools, bound
 * its file reads and searches to an empty working directory, and load no user config, hooks, rules, plugins or
 * MCP servers, and reads what the CLI prints. The sign-in lives outside those dirs — the login keychain on
 * macOS, an `auth.json` under the XDG or app-data path on Linux and Windows — so it keeps working untouched,
 * and `CURSOR_API_KEY` remains the documented headless sign-in.
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
	 * The chat the call saves lives in the call's scratch data dir and is deleted with it.
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
			await writeCursorConfig(place, null);

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
	 * version documents it, and a CLI that rejects the flag is asked again plainly. The check runs under the same
	 * isolated config and data dirs a call gets, in an empty working directory, so it reports the sign-in a run
	 * will find — never one only the user's own config could give.
	 */
	protected async signIn(path: string): Promise<Pick<AgentStatus, 'signedIn'>> {
		const scratch = await mkdtemp(join(tmpdir(), 'recoder-cursor-status-'));

		this.scratch.add(scratch);

		const place = {
			config: join(scratch, 'config'),
			data: join(scratch, 'data'),
			cwd: join(scratch, 'work')
		};

		try {
			await writeCursorConfig(place, null);

			const where = {
				cwd: place.cwd,
				env: { ...cursorEnv(this.env), CURSOR_CONFIG_DIR: place.config, CURSOR_DATA_DIR: place.data }
			};

			const json = await this.output(path, ['status', '--format', 'json'], STATUS_TIMEOUT_MS, undefined, where);
			const state = signInState(json.code, json.stdout);

			if (state !== null && json.stdout.trimStart().startsWith('{')) return { signedIn: state };

			const plain = await this.output(path, ['status'], STATUS_TIMEOUT_MS, undefined, where);

			return { signedIn: signInState(plain.code, plain.stdout) };
		} finally {
			this.scratch.delete(scratch);
			await rm(scratch, { recursive: true, force: true });
		}
	}

	/** The CLI's path, or the install hint every entry point throws when it is missing. */
	private requireCli(): string {
		const path = this.find();

		if (!path) throw new LlmError(0, `Cursor is not installed. Install it with: ${INSTALL}`);

		return path;
	}

	/**
	 * One print-mode call in the isolated dirs: streams `stream-json` events through a {@link CursorReader},
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
		const outcome = await streamPrintCall({
			argv: [path, ...PRINT_ARGS, '--trust', '--workspace', place.cwd, '--model', model],
			cwd: place.cwd,
			env: { ...cursorEnv(this.env), CURSOR_CONFIG_DIR: place.config, CURSOR_DATA_DIR: place.data },
			stdin,
			signal,
			running: this.running,
			name: this.name,
			handlers: {
				text: (delta) => handlers.onToken?.(delta),
				reasoning: (delta) => handlers.onReasoning?.(delta),
				apiKeySource: handlers.onApiKeySource
			}
		});

		if (!outcome.ok) throw outcome.error;

		return this.reply(outcome.reader, outcome.exit, handlers.onUsage);
	}

	/** The call's answer, its usage reported, or the failure thrown. */
	private reply(reader: CursorReader, exit: CliExit, onUsage: ((usage: TokenUsage) => void) | undefined): string {
		const failure = reader.failure(exit);

		if (failure) throw failure;

		const reported = reader.usage();

		if (reported) onUsage?.(reported.usage);

		return reader.answer();
	}

	/**
	 * Run a short CLI command to its end in an empty directory — `where` overrides both when a caller needs the
	 * isolated dirs — killing it after `timeoutMs`, or when `signal` aborts.
	 */
	private async output(
		path: string,
		args: string[],
		timeoutMs: number,
		signal?: AbortSignal,
		where?: { cwd: string; env: Record<string, string> }
	): Promise<{ code: number; stdout: string; stderr: string }> {
		const proc = Bun.spawn([path, ...args], {
			stdout: 'pipe',
			stderr: 'pipe',
			cwd: where?.cwd ?? (await emptyDirectory('cursor-empty')),
			env: where?.env ?? cursorEnv(this.env),
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
