import type { AgentStatus, ModelEntry, TokenUsage } from '@recoder/shared';
import { LlmError } from '../../models/llm/errors';
import type { ChatOptions } from '../../models/llm/types';
import {
	CliAgent,
	callDeadline,
	cliOutput,
	emptyDirectory,
	findCli,
	removeScratchDir,
	scratchDir,
	stopOnShutdown
} from '../cli-process';
import { promptText, systemText } from '../cli-prompt';
import type { CliExit } from '../cli-stream';
import { quotedLine } from '../quoted-line';
import type { AgentModelSettings, AgentRun, AgentRunOptions, AgentSetup } from '../contract';
import { parseCursorModels } from './cursor-models';
import { CURSOR_LOGIN, CursorReader, SIGNED_OUT_FIX, signInState } from './cursor-output';
import { PRINT_ARGS, streamPrintCall } from './cursor-print';
import {
	cursorConfigDir,
	cursorEnv,
	cursorPlace,
	cursorSetupEnv,
	writeCursorConfig,
	type CursorPlace
} from './cursor-process';
import { CursorRun } from './cursor-run';

const INSTALL = 'curl -fsSL https://cursor.com/install | bash';

const STATUS_TIMEOUT_MS = 10_000;

const MODELS_TIMEOUT_MS = 20_000;

/**
 * Cursor, run as one `cursor-agent -p` process per model call.
 *
 * The CLI signs in itself. Recoder never reads its credential file; it runs the CLI under isolated
 * `CURSOR_CONFIG_DIR` and `CURSOR_DATA_DIR` dirs that deny its shell, file-edit and web tools, bound
 * its file reads and searches to an empty working directory on CLIs with read access (Cursor 3.23+), and load no
 * user config, hooks, rules, plugins or MCP servers, and reads what the CLI prints. One file of the user's own
 * config is linked in: `auth.json`, the credential file a `cursor-agent login` sign-in leaves, so that sign-in
 * reaches a run and the CLI can refresh it in place. `CURSOR_API_KEY` is the documented headless sign-in and
 * reaches every call.
 */
export class CursorAgent extends CliAgent {
	readonly id = 'cursor';
	readonly name = 'Cursor';
	/** Its print mode documents no image input. */
	readonly readsImages = false;
	readonly install = INSTALL;
	readonly login = CURSOR_LOGIN;
	/** Each call runs one CLI process, so four run at once unless `RECODER_CURSOR_CONCURRENCY` says otherwise. */
	readonly processCeiling = { env: 'RECODER_CURSOR_CONCURRENCY', fallback: 4 };
	readonly signInFix = `${SIGNED_OUT_FIX} Or pick another model in Recoder settings.`;
	/**
	 * The setup Settings runs: the vendor install script, piped to `bash` by the job runner, and
	 * `cursor-agent login` with `NO_OPEN_BROWSER` so it prints the sign-in URL instead of opening it; its loopback
	 * callback finishes the sign-in once the browser does.
	 */
	readonly setup: AgentSetup = {
		install: { argv: ['bash', '-s'], stdinUrl: 'https://cursor.com/install' },
		signIn: { argv: ['cursor-agent', 'login'], env: { NO_OPEN_BROWSER: '1' } }
	};

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
		const scratch = await scratchDir(this.scratch, 'recoder-cursor-');
		const place = cursorPlace(scratch, this.env);

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
			await removeScratchDir(this.scratch, scratch);
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
	 * The environment a `cursor-agent login` job gets: the call env with the user's own `CURSOR_CONFIG_DIR` and
	 * `CURSOR_DATA_DIR` back when they set them, so the sign-in lands where the user's own CLI reads it.
	 */
	override setupEnv(): Record<string, string> {
		return cursorSetupEnv(this.env);
	}

	protected configDir(): string {
		return cursorConfigDir(this.env);
	}

	/**
	 * `cursor-agent status` reports the account's sign-in state; `--format json` is tried first since not every
	 * version documents it, and a CLI that rejects the flag is asked again plainly. The check runs under the same
	 * isolated config and data dirs a call gets, in an empty working directory, so it reports the sign-in a run
	 * will find — never one only the user's own config could give.
	 */
	protected async signIn(path: string): Promise<Pick<AgentStatus, 'signedIn'>> {
		const scratch = await scratchDir(this.scratch, 'recoder-cursor-status-');
		const place = cursorPlace(scratch, this.env);

		try {
			await writeCursorConfig(place, this.env, null);

			const where = { cwd: place.cwd, env: place.env };

			const json = await this.output(path, ['status', '--format', 'json'], STATUS_TIMEOUT_MS, undefined, where);
			const state = signInState(json.code, json.stdout);

			if (state !== null && json.stdout.trimStart().startsWith('{')) return { signedIn: state };

			const plain = await this.output(path, ['status'], STATUS_TIMEOUT_MS, undefined, where);

			return { signedIn: signInState(plain.code, plain.stdout) };
		} finally {
			await removeScratchDir(this.scratch, scratch);
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
		place: CursorPlace,
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
			env: place.env,
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
	 * isolated dirs — killing it after `timeoutMs`, or when `signal` aborts. See {@link cliOutput}.
	 */
	private async output(
		path: string,
		args: string[],
		timeoutMs: number,
		signal?: AbortSignal,
		where?: { cwd: string; env: Record<string, string> }
	): Promise<{ code: number; stdout: string; stderr: string }> {
		return cliOutput([path, ...args], {
			env: where?.env ?? cursorEnv(this.env),
			cwd: where?.cwd ?? (await emptyDirectory('cursor-empty')),
			timeoutMs,
			signal
		});
	}
}

export const cursor = new CursorAgent();

stopOnShutdown('cursor', () => cursor.stop());
