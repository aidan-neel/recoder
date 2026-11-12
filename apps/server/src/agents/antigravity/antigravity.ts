import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { supportedEffort, type AgentStatus, type ModelEntry, type ReasoningEffort } from '@recoder/shared';
import { LlmError } from '../../models/llm/errors';
import type { ChatOptions } from '../../models/llm/types';
import { CliAgent, callDeadline, emptyDirectory, findCli, stopOnShutdown } from '../cli-process';
import { promptText, systemText } from '../cli-prompt';
import { CLI_OUTPUT_CAP_BYTES, LineSplitter } from '../cli-stream';
import type { AgentModelSettings, AgentRun, AgentRunOptions } from '../contract';
import { ConversationLedger, ConversationTracker } from './antigravity-conversations';
import { antigravityEfforts, effortArgs, parseAntigravityModels } from './antigravity-models';
import { ReplyReader, antigravityError, isSignedOutOutput } from './antigravity-output';
import {
	ANTIGRAVITY_LOGIN,
	ANTIGRAVITY_STREAM_ARGS,
	antigravityEnv,
	stdinPrompt,
	writeWorkspaceFiles
} from './antigravity-process';
import { AntigravityRun } from './antigravity-run';

const INSTALL = 'curl -fsSL https://antigravity.google/cli/install.sh | bash';

const STATUS_TIMEOUT_MS = 10_000;

const MODELS_TIMEOUT_MS = 20_000;

const ANTIGRAVITY_PROBE_DIR = 'antigravity-probe';

/**
 * Antigravity CLI (`agy`), run as one headless `stream-json` process per call.
 *
 * The CLI manages its own Google sign-in. Recoder never reads its credential files; it runs `agy` in an isolated
 * empty directory without the server's keys, under a session-only settings file and custom agent definition that turn
 * every built-in tool and user customization off.
 */
export class AntigravityAgent extends CliAgent {
	readonly id = 'antigravity';
	readonly name = 'Antigravity';
	readonly install = INSTALL;
	readonly login = ANTIGRAVITY_LOGIN;
	/** Each call starts one `agy` process, capped at four at once unless `RECODER_ANTIGRAVITY_CONCURRENCY` overrides it. */
	readonly processCeiling = { env: 'RECODER_ANTIGRAVITY_CONCURRENCY', fallback: 4 };
	readonly signInFix = `Sign in with \`${ANTIGRAVITY_LOGIN}\`, or pick another model in Recoder settings.`;

	private readonly known = new Map<string, ModelEntry>();
	private readonly conversations = new ConversationLedger(this.env, this.running);

	/** Lists the account's models via `agy --output-format json models`, aborting the child immediately on `signal`. */
	async models(signal?: AbortSignal): Promise<ModelEntry[]> {
		const binary = this.requireBinary();
		const { code, stdout, stderr } = await this.probeModels(binary, MODELS_TIMEOUT_MS, signal);

		if (code !== 0) {
			throw antigravityError(stderr || stdout || `Antigravity models exited with code ${code}.`);
		}

		const listed = parseAntigravityModels(stdout);

		if (!listed.length) throw new LlmError(0, 'Antigravity listed no models.');

		this.cacheModels(listed);

		return listed;
	}

	/** Resolves the model's reasoning effort against its supported levels, or `{}` for single-effort models. */
	modelSettings(model: string, requested: ReasoningEffort | undefined): AgentModelSettings {
		const catalog = antigravityEfforts(model, this.known);

		if (!catalog.efforts || !catalog.defaultEffort) return {};

		return {
			reasoningEffort: supportedEffort(requested ?? catalog.defaultEffort, catalog.efforts, catalog.defaultEffort)
		};
	}

	/** Opens a multi-prompt review run exposing Recoder's tools over MCP. See {@link AntigravityRun}. */
	openRun(options: AgentRunOptions): Promise<AgentRun> {
		return AntigravityRun.open(
			{
				path: this.requireBinary(),
				env: this.env,
				known: this.known,
				scratch: this.scratch,
				conversations: this.conversations
			},
			options
		);
	}

	/** Runs one tool-free completion, streaming deltas to `onToken` and deleting the saved conversation afterwards. */
	async complete(opts: ChatOptions, onToken?: (text: string) => void): Promise<string> {
		const binary = this.requireBinary();
		const scratch = await mkdtemp(join(tmpdir(), 'recoder-antigravity-'));
		const deadline = callDeadline(opts);
		const conversations = new ConversationTracker(this.conversations);

		const reader = new ReplyReader({
			onText: onToken,
			onThinking: opts.onReasoning,
			onConversation: conversations.add
		});

		const splitter = new LineSplitter(reader.line);

		this.scratch.add(scratch);

		try {
			const { cwd, settingsFile } = await writeWorkspaceFiles(scratch, {
				system: systemText(opts),
				lease: null,
				tools: []
			});

			const turns = opts.messages.filter((message) => message.role !== 'system');

			const args = [
				...ANTIGRAVITY_STREAM_ARGS,
				'--settings',
				settingsFile,
				'--model',
				opts.model,
				...effortArgs(opts.model, opts.reasoningEffort, this.known)
			];

			const exit = await this.conversations.stream({
				argv: [binary, ...args],
				cwd,
				env: antigravityEnv(this.env),
				stdin: stdinPrompt(promptText(turns)),
				signal: deadline.signal,
				maxOutputBytes: CLI_OUTPUT_CAP_BYTES,
				onOutput: splitter.push,
				name: this.name
			});

			splitter.end();

			return reader.finish(opts.onUsage, exit);
		} catch (error) {
			splitter.end();
			throw deadline.failure(error, 'Antigravity request failed.');
		} finally {
			await Promise.all([
				rm(scratch, { recursive: true, force: true }).then(() => {
					this.scratch.delete(scratch);
				}),
				conversations.removeAll()
			]);
		}
	}

	/** Kills in-flight process groups and synchronously sweeps temporary workspaces and conversations on exit. */
	override stop(): void {
		super.stop();
		this.conversations.sweep();
	}

	protected find(): string | null {
		return findCli({ pin: 'RECODER_ANTIGRAVITY_BIN', command: 'agy', installed: ['.local', 'bin', 'agy'] }, this.env);
	}

	protected childEnv(): Record<string, string> {
		return antigravityEnv(this.env);
	}

	/**
	 * `agy` has no standalone `auth status` subcommand; `agy --output-format json models` checks sign-in without a
	 * model call, exiting 0 with the catalog when signed in and 1 with `"Please sign in..."` when signed out.
	 */
	protected async signIn(path: string): Promise<Pick<AgentStatus, 'signedIn'>> {
		try {
			const { code, stdout, stderr } = await this.probeModels(path, STATUS_TIMEOUT_MS);

			if (code === 0) {
				const listed = parseAntigravityModels(stdout);

				if (listed.length > 0) {
					this.cacheModels(listed);

					return { signedIn: true };
				}
			}

			if (isSignedOutOutput(`${stderr}\n${stdout}`)) return { signedIn: false };

			return { signedIn: null };
		} catch {
			return { signedIn: null };
		}
	}

	private requireBinary(): string {
		const binary = this.find();

		if (!binary) throw new LlmError(0, `Antigravity is not installed. Install it with: ${INSTALL}`);

		return binary;
	}

	private cacheModels(entries: readonly ModelEntry[]): void {
		this.known.clear();
		for (const entry of entries) this.known.set(entry.model, entry);
	}

	/** Runs `agy --output-format json models` in an empty directory, killing its process group on timeout or abort. */
	private async probeModels(
		path: string,
		timeoutMs: number,
		signal?: AbortSignal
	): Promise<{ code: number; stdout: string; stderr: string }> {
		const cwd = await emptyDirectory(ANTIGRAVITY_PROBE_DIR);
		const deadline = callDeadline({ timeoutMs, signal });
		let stdout = '';

		try {
			const { code, stderr } = await this.conversations.stream({
				argv: [path, '--output-format', 'json', 'models'],
				cwd,
				env: antigravityEnv(this.env),
				stdin: null,
				signal: deadline.signal,
				maxOutputBytes: CLI_OUTPUT_CAP_BYTES,
				onOutput: (chunk) => {
					stdout += chunk;
				},
				name: this.name
			});

			return { code, stdout, stderr };
		} catch (error) {
			throw deadline.failure(error, 'Antigravity models check failed.');
		}
	}
}

export const antigravity = new AntigravityAgent();

stopOnShutdown('antigravity', () => antigravity.stop());
