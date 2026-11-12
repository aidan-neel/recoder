import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentStatus, ModelEntry, ReasoningEffort } from '@recoder/shared';
import { LlmError } from '../../models/llm/errors';
import type { ChatOptions } from '../../models/llm/types';
import { callDeadline, cliOutput, emptyDirectory, findCli, stopOnShutdown } from '../cli-process';
import { promptText, systemText } from '../cli-prompt';
import { CLI_OUTPUT_CAP_BYTES, LineSplitter, streamCli } from '../cli-stream';
import { SessionCliAgent } from '../session-run';
import type { AgentEvent, AgentModelSettings, AgentRun, AgentRunOptions } from '../contract';
import { codexEffort, parseCodexModels } from './codex-models';
import { CODEX_LOGIN, CodexReader } from './codex-output';
import { callArgs, codexEnv } from './codex-process';
import { CodexRun } from './codex-run';

const INSTALL = 'npm install -g @openai/codex';

const STATUS_TIMEOUT_MS = 10_000;

const MODELS_TIMEOUT_MS = 20_000;

const FORGET_TIMEOUT_MS = 10_000;

/**
 * Codex, run as one `codex exec` process per model call.
 *
 * The CLI signs in itself and keeps its sign-in under `CODEX_HOME`. Recoder never reads it; it runs the CLI
 * without the server's keys in its environment, without the user's config, rules, hooks, plugins or own tools, and
 * reads the JSONL events the CLI prints.
 */
export class CodexAgent extends SessionCliAgent {
	readonly id = 'codex';
	readonly name = 'Codex';
	readonly install = INSTALL;
	readonly login = CODEX_LOGIN;
	/** Each call runs one CLI process, so four run at once unless `RECODER_CODEX_CONCURRENCY` says otherwise. */
	readonly processCeiling = { env: 'RECODER_CODEX_CONCURRENCY', fallback: 4 };
	readonly signInFix = `Sign in with \`${CODEX_LOGIN}\`, or pick another model in Recoder settings.`;

	/** The models the last listing found, for the effort levels {@link modelSettings} answers with. */
	private listed = new Map<string, ModelEntry>();

	/**
	 * The account's models, from the catalog `codex debug models` prints; throws when the CLI is missing or lists
	 * none. When `signal` aborts, the CLI process is killed and the call rejects.
	 */
	async models(signal?: AbortSignal): Promise<ModelEntry[]> {
		const path = this.requirePath();
		const { stdout } = await this.output(path, ['debug', 'models'], MODELS_TIMEOUT_MS, signal);
		const models = parseCodexModels(stdout);

		if (!models.length) throw new LlmError(0, 'Codex listed no models.');

		this.listed = new Map(models.map((entry) => [entry.model, entry]));

		return models;
	}

	/** The picked effort when the model offers it, else the model's default. */
	modelSettings(model: string, requested: ReasoningEffort | undefined): AgentModelSettings {
		return { reasoningEffort: codexEffort(this.listed.get(model), requested) };
	}

	/** A run in which Codex is the agent, with Recoder's tools over MCP. See {@link CodexRun}. */
	async openRun(options: AgentRunOptions): Promise<AgentRun> {
		const path = this.requirePath();

		return CodexRun.open(this.sessionHost(path), options);
	}

	/**
	 * One model call with no tools, saving no session (`--ephemeral`). The system prompt goes in a file and the turns
	 * on stdin, since a review's diff can pass the kernel's per-argument limit. Each finished message streams to
	 * `onToken`, each reasoning summary to `onReasoning`, and the turn's usage to `onUsage`.
	 */
	async complete(opts: ChatOptions, onToken?: (text: string) => void): Promise<string> {
		const path = this.requirePath();
		const deadline = callDeadline(opts);
		const scratch = await mkdtemp(join(tmpdir(), 'recoder-codex-'));
		const systemFile = join(scratch, 'system.md');

		this.scratch.add(scratch);

		try {
			await writeFile(systemFile, systemText(opts), { mode: 0o600 });

			const effort = opts.thinking === false ? 'low' : opts.reasoningEffort;
			const flags = callArgs({ model: opts.model, reasoningEffort: effort, systemFile, lease: null });
			const reader = new CodexReader(callEvents(opts, onToken), 'codex');
			const lines = new LineSplitter(reader.line);

			const exit = await streamCli({
				argv: [path, 'exec', '--ephemeral', ...flags, '-'],
				cwd: await emptyDirectory('codex-empty'),
				env: codexEnv(this.env),
				stdin: promptText(opts.messages.filter((m) => m.role !== 'system')),
				signal: deadline.signal,
				maxOutputBytes: CLI_OUTPUT_CAP_BYTES,
				onOutput: lines.push,
				running: this.running,
				name: this.name
			});

			lines.end();

			const { text, error, tokens } = reader.finish(exit);

			if (tokens) opts.onUsage?.(tokens);
			if (error) throw error;

			return text;
		} catch (error) {
			throw deadline.failure(error, 'Codex request failed.');
		} finally {
			this.scratch.delete(scratch);
			await rm(scratch, { recursive: true, force: true });
		}
	}

	protected find(): string | null {
		return findCli({ pin: 'RECODER_CODEX_BIN', command: 'codex', installed: ['.local', 'bin', 'codex'] }, this.env);
	}

	protected childEnv(): Record<string, string> {
		return codexEnv(this.env);
	}

	/** `codex login status` exits 0 when signed in. */
	protected async signIn(path: string): Promise<Pick<AgentStatus, 'signedIn'>> {
		return { signedIn: (await this.output(path, ['login', 'status'], STATUS_TIMEOUT_MS)).code === 0 };
	}

	private requirePath(): string {
		const path = this.find();

		if (!path) throw new LlmError(0, `Codex is not installed. Install it with: ${INSTALL}`);

		return path;
	}

	/**
	 * Deletes the session the CLI saved for a run, which holds the review's prompts, and resolves once `codex delete`
	 * has exited. Its exit code is not read: a session the CLI never saved has nothing to delete.
	 */
	protected async forget(path: string, session: string): Promise<void> {
		await this.output(path, ['delete', '--force', session], FORGET_TIMEOUT_MS);
	}

	/** Run a short CLI command in an empty directory, so it never sees the user's files. See {@link cliOutput}. */
	private async output(
		path: string,
		args: string[],
		timeoutMs: number,
		signal?: AbortSignal
	): Promise<{ code: number; stdout: string }> {
		const cwd = await emptyDirectory('codex-empty');

		return cliOutput([path, ...args], { env: codexEnv(this.env), cwd, timeoutMs, signal });
	}
}

/** The events of a single call, passed on to its callbacks: text to `onToken`, reasoning summaries to `onReasoning`. */
function callEvents(opts: ChatOptions, onToken: ((text: string) => void) | undefined): (event: AgentEvent) => void {
	return (event) => {
		if (event.type === 'text') onToken?.(event.delta);
		if (event.type === 'reasoning') opts.onReasoning?.(event.delta);
	};
}

export const codex = new CodexAgent();

stopOnShutdown('codex', () => codex.stop());
