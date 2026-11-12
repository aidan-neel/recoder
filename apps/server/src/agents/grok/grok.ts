import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentStatus, ModelEntry } from '@recoder/shared';
import { LlmError } from '../../models/llm/errors';
import type { ChatOptions } from '../../models/llm/types';
import { CliAgent, callDeadline, emptyDirectory, findCli, stopOnShutdown } from '../cli-process';
import { promptText, systemText } from '../cli-prompt';
import { CLI_OUTPUT_CAP_BYTES, LineSplitter, streamCli } from '../cli-stream';
import { quotedLine } from '../quoted-line';
import type { AgentModelSettings, AgentRun, AgentRunOptions } from '../contract';
import { parseGrokModels } from './grok-models';
import { grokEnv, prepareHome, realAuthPath } from './grok-process';
import { ReplyReader, SIGNED_OUT } from './grok-reply';
import { GROK_EMPTY_DIR, GrokRun, PRINT_ARGS } from './grok-run';

const INSTALL = 'curl -fsSL https://x.ai/cli/install.sh | bash';

const LOGIN = 'grok login';

const STATUS_TIMEOUT_MS = 15_000;

const MODELS_TIMEOUT_MS = 20_000;

/** Longest stretch of a CLI error line quoted in a `models` failure. */
const QUOTED_CHARS = 120;

/** A tool-less call's turn cap: room for the model to answer after a refused or empty tool lookup, nothing more. */
const COMPLETE_MAX_TURNS = '4';

/**
 * Grok Build, run as one `grok` process per model call or prompt.
 *
 * The CLI signs in itself (browser OAuth into `~/.grok/auth.json`, or `XAI_API_KEY`). Recoder never reads,
 * copies, links or moves that file: each call gets an empty home, and `GROK_AUTH_PATH` names the user's own
 * file, so the CLI reads and refreshes the real credentials in place. Its environment loses the server's keys and every
 * `GROK_*`/`RECODER_*` override, its user config, plugins, hooks, rules, memory and compat surfaces (Claude and
 * Cursor dirs) stay out through the fake home and the `GROK_*_ENABLED=false` switches, and its own tools are
 * off by flag — Recoder's reach it only over the MCP server a run's project config names.
 */
export class GrokAgent extends CliAgent {
	readonly id = 'grok';
	readonly name = 'Grok Build';
	readonly install = INSTALL;
	readonly login = LOGIN;
	/** Each call runs one CLI process, so four run at once unless `RECODER_GROK_CONCURRENCY` says otherwise. */
	readonly processCeiling = { env: 'RECODER_GROK_CONCURRENCY', fallback: 4 };
	readonly signInFix = `Sign in with \`${LOGIN}\`, or pick another model in Recoder settings.`;

	/** The home the status checks share: prepared once, kept until `stop`, so `models` and sign-in see one config. */
	private homeDir: string | null = null;

	/**
	 * The account's models, from `grok models`; throws when the CLI is missing, cannot list, or lists none. When
	 * `signal` aborts, the CLI process is killed and the call rejects.
	 */
	async models(signal?: AbortSignal): Promise<ModelEntry[]> {
		const { code, stdout, stderr } = await this.cliOutput(this.requirePath(), ['models'], MODELS_TIMEOUT_MS, signal);
		const listed = parseGrokModels(stdout);

		if (listed.length) return listed;

		throw new LlmError(0, `Grok Build listed no models${noModelsReason(code, stderr)}`);
	}

	/** `grok models` names no effort levels per model, so a Grok model has none to set. */
	modelSettings(): AgentModelSettings {
		return {};
	}

	/** A run in which Grok Build is the agent, with Recoder's tools over MCP. See {@link GrokRun}. */
	async openRun(options: AgentRunOptions): Promise<AgentRun> {
		const host = { path: this.requirePath(), env: this.env, running: this.running, scratch: this.scratch };

		return GrokRun.open(host, options);
	}

	/**
	 * One model call, tool-less: its own empty home and working directory under one scratch dir, deleted after.
	 * The system prompt goes in `--system-prompt-override` and the turns in a prompt file, since a review's diff
	 * can pass the kernel's per-argument limit. Text streams to `onToken`; usage and the auth source come from
	 * the stream's `init` and `result` lines. Each call is a fresh session: its home is deleted with it, so there
	 * is nothing to resume — the turns carry the whole context.
	 */
	async complete(opts: ChatOptions, onToken?: (text: string) => void): Promise<string> {
		const deadline = callDeadline(opts);
		const scratch = await mkdtemp(join(tmpdir(), 'recoder-grok-'));
		const home = join(scratch, 'home');
		const cwd = join(scratch, 'work');
		const promptFile = join(scratch, 'prompt.md');
		const authPath = realAuthPath(this.env);

		this.scratch.add(scratch);

		try {
			prepareHome(home);
			await mkdir(cwd, { recursive: true });
			await writeFile(promptFile, promptText(opts.messages.filter((m) => m.role !== 'system')), { mode: 0o600 });

			const args = [
				...PRINT_ARGS,
				'--prompt-file',
				promptFile,
				'--model',
				opts.model,
				'--system-prompt-override',
				systemText(opts),
				'--max-turns',
				COMPLETE_MAX_TURNS,
				'-s',
				randomUUID()
			];

			return await this.call(this.requirePath(), args, { cwd, home, authPath }, opts, deadline.signal, onToken);
		} catch (error) {
			throw deadline.failure(error, 'Grok Build request failed.');
		} finally {
			this.scratch.delete(scratch);
			await rm(scratch, { recursive: true, force: true });
		}
	}

	/**
	 * Runs the CLI for one `complete()` call and reads its `streaming-messages-json` output through
	 * {@link ReplyReader}: deltas stream to the handlers, the `result` line is the answer. See
	 * {@link streamCli} for how an abort or a runaway output stops it.
	 */
	private async call(
		path: string,
		args: string[],
		where: { cwd: string; home: string; authPath: string | null },
		opts: ChatOptions,
		signal: AbortSignal,
		onToken: ((text: string) => void) | undefined
	): Promise<string> {
		const reader = new ReplyReader({
			onApiKeySource: (source) => this.reportApiKeySource(opts, source),
			onThinking: opts.onReasoning,
			onText: onToken
		});

		const lines = new LineSplitter(reader.line);

		const exit = await streamCli({
			name: this.name,
			running: this.running,
			argv: [path, ...args],
			cwd: where.cwd,
			env: grokEnv(this.env, where.home, where.authPath),
			stdin: null,
			signal,
			maxOutputBytes: CLI_OUTPUT_CAP_BYTES,
			onOutput: lines.push
		});

		lines.end();

		return reader.finish(opts.onUsage, exit);
	}

	/** Remembers what paid for the last call and tells the request's own listener, when it has one. */
	private reportApiKeySource(opts: ChatOptions, source: string): void {
		this.apiKeySource = source;
		if (this.status) this.status.apiKeySource = source;
		opts.onApiKeySource?.(source);
	}

	protected find(): string | null {
		return findCli({ pin: 'RECODER_GROK_BIN', command: 'grok', installed: ['.grok', 'bin', 'grok'] }, this.env);
	}

	/** The binary, or the error every entry point raises when it is not installed. */
	private requirePath(): string {
		const path = this.find();

		if (!path) throw new LlmError(0, `Grok Build is not installed. Install it with: ${INSTALL}`);

		return path;
	}

	/** The environment every call gets: stripped keys, the call's own home, compat surfaces and memory off. */
	protected childEnv(): Record<string, string> {
		return grokEnv(this.env, this.statusHome(), realAuthPath(this.env));
	}

	/**
	 * The sign-in state from `grok models`, which needs the account: its first line says "You are logged in with
	 * …". A clean exit without that line is unknown (another auth path may word it differently); a check that
	 * could not run — a timeout or a spawn failure — is unknown too, and only a CLI that exits and whose output
	 * says it is signed out is `false`.
	 */
	protected async signIn(path: string): Promise<Pick<AgentStatus, 'signedIn'>> {
		const ran = await this.cliOutput(path, ['models'], STATUS_TIMEOUT_MS).catch(() => null);

		if (ran === null) return { signedIn: null };
		if (/logged in with/i.test(ran.stdout)) return { signedIn: true };
		if (ran.code !== 0 && SIGNED_OUT.test(`${ran.stderr}\n${ran.stdout}`)) return { signedIn: false };

		return { signedIn: null };
	}

	/** The shared home the status checks run under, prepared on first use and removed by `stop` with the rest. */
	private statusHome(): string {
		if (!this.homeDir) {
			this.homeDir = mkdtempSync(join(tmpdir(), 'recoder-grok-status-'));
			this.scratch.add(this.homeDir);
			prepareHome(this.homeDir);
		}

		return this.homeDir;
	}

	/** Run a short CLI command to its end under the status home, killing it after `timeoutMs` or when `signal` aborts. */
	private async cliOutput(
		path: string,
		args: string[],
		timeoutMs: number,
		signal?: AbortSignal
	): Promise<{ code: number; stdout: string; stderr: string }> {
		let stdout = '';
		const cwd = await emptyDirectory(GROK_EMPTY_DIR);
		const deadline = callDeadline({ timeoutMs, signal });

		const exit = await streamCli({
			name: this.name,
			running: this.running,
			argv: [path, ...args],
			cwd,
			env: grokEnv(this.env, this.statusHome(), realAuthPath(this.env)),
			stdin: null,
			signal: deadline.signal,
			maxOutputBytes: CLI_OUTPUT_CAP_BYTES,
			onOutput: (piece) => {
				stdout += piece;
			}
		});

		return { code: exit.code, stdout, stderr: exit.stderr };
	}
}

/**
 * Why `grok models` listed nothing: a clean exit that printed no models, or a failed call's last stderr line,
 * quoted through `quotedLine` so a credential in it never reaches the message.
 */
function noModelsReason(code: number, stderr: string): string {
	if (code === 0) return '.';

	const why = stderr.trim().split('\n').at(-1)?.trim();

	if (!why) return ` (exit ${code}).`;

	return ` (exit ${code}: ${quotedLine(why, QUOTED_CHARS)}).`;
}

export const grok = new GrokAgent();

stopOnShutdown('grok', () => grok.stop());
