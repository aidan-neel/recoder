import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { supportedEffort, within, type AgentStatus, type ModelEntry, type ReasoningEffort } from '@recoder/shared';
import { LlmError } from '../../models/llm/errors';
import type { ChatOptions } from '../../models/llm/types';
import {
	CliAgent,
	callDeadline,
	emptyDirectory,
	findCli,
	removeScratchDir,
	scratchDir,
	stopOnShutdown
} from '../cli-process';
import { systemText } from '../cli-prompt';
import { CLI_OUTPUT_CAP_BYTES, LineSplitter, streamCli } from '../cli-stream';
import type { AgentModelSettings, AgentRun, AgentRunOptions, AgentSetup } from '../contract';
import { claudeCodeEfforts, claudeCodeModels, effortArgs } from './claude-code-models';
import { FailedCallDump } from './claude-code-debug';
import { claudeCodeInput } from './claude-code-input';
import { claudeCodeEnv, claudeConfigDir } from './claude-code-process';
import { ReplyReader } from './claude-code-reply';
import { ClaudeCodeRun, CLAUDE_CODE_EMPTY_DIR } from './claude-code-run';
import { sessionCall, sweepSessions, type SessionCall } from './claude-code-session';

const INSTALL = 'curl -fsSL https://claude.ai/install.sh | bash';

const LOGIN = 'claude auth login';

const STATUS_TIMEOUT_MS = 10_000;

/**
 * How long a check waits on `claude auth status` (which can take five seconds) once a check has found the CLI
 * signed in. Past this it answers with that, and the status call goes on to correct the status if it changed.
 */
const SIGN_IN_WAIT_MS = 1_500;

type SignIn = Pick<AgentStatus, 'signedIn' | 'authMethod'>;

/**
 * Print mode with everything but the model call turned off: no tools, a permission mode that refuses any tool,
 * and `--safe-mode` so the user's CLAUDE.md, hooks, plugins, skills and MCP servers never load. Safe mode still
 * applies the `env` of a settings file, where `DISABLE_PROMPT_CACHING` or a thinking budget would change every
 * call, so no settings file is read; the subscription sign-in does not live in one. A model can still
 * write a tool call; the CLI answers that no such tool exists, which takes a second turn, and the model then
 * replies in text, so three turns leave room for that without letting a call run on. `stream-json` needs
 * `--verbose` in print mode, and carries the error code of a failed call.
 */
const BASE_ARGS = [
	'-p',
	'--safe-mode',
	'--setting-sources',
	'',
	'--strict-mcp-config',
	'--disable-slash-commands',
	'--tools',
	'',
	'--permission-mode',
	'dontAsk',
	'--max-turns',
	'3',
	'--output-format',
	'stream-json',
	'--verbose',
	'--include-partial-messages'
];

/**
 * Claude Code, run as one `claude -p` process per model call.
 *
 * The CLI signs in with the user's own subscription. Model calls never use its
 * token: Recoder only runs the CLI, without the server's keys in its
 * environment, and reads what the CLI prints. The one read of its sign-in is
 * the subscription's usage limits Settings shows (`limits.ts`), which no CLI
 * command prints.
 */
export class ClaudeCodeAgent extends CliAgent {
	readonly id = 'claude-code';
	readonly name = 'Claude Code';
	/** Images go in as image blocks of a `stream-json` user message, see {@link claudeCodeInput}. */
	readonly readsImages = true;
	readonly install = INSTALL;
	readonly login = LOGIN;
	/** Each call runs one CLI process, so eight run at once unless `RECODER_CLAUDE_CODE_CONCURRENCY` says otherwise. */
	readonly processCeiling = { env: 'RECODER_CLAUDE_CODE_CONCURRENCY', fallback: 8 };
	readonly signInFix = `Sign in with \`${LOGIN}\`, or pick another model in Recoder settings.`;
	/**
	 * The setup Settings runs: the vendor install script, piped to `bash` by the job runner, and `claude auth login`,
	 * which prints the sign-in URL and waits for the pasted code. The sign-in lands in `CLAUDE_CONFIG_DIR` — the
	 * environment keeps it — so it is the user's own.
	 */
	readonly setup: AgentSetup = {
		install: { argv: ['bash', '-s'], stdinUrl: 'https://claude.ai/install.sh' },
		signIn: { argv: ['claude', 'auth', 'login'], needsInput: true }
	};

	/** The latest `claude auth status` call while it runs, which a check that may take an older answer joins. */
	private signInCall: Promise<SignIn> | null = null;

	/** What the newest status call that answered clearly found; null until one has. */
	private signedInAs: SignIn | null = null;

	/** Numbers the status calls in the order they start, so an answer never replaces one from a newer call. */
	private callsStarted = 0;
	private keptCall = 0;

	async models(): Promise<ModelEntry[]> {
		return claudeCodeModels();
	}

	/** The CLI has no command that lists models, so its list is fixed and offered whether or not it is installed. */
	override fixedModels(): ModelEntry[] {
		return claudeCodeModels();
	}

	/** A model that takes effort levels gets the picked one when it offers it, else its default; others get none. */
	modelSettings(model: string, requested: ReasoningEffort | undefined): AgentModelSettings {
		const { efforts, defaultEffort } = claudeCodeEfforts(model);

		return efforts ? { reasoningEffort: supportedEffort(requested ?? defaultEffort, efforts, defaultEffort) } : {};
	}

	/** A run in which Claude Code is the agent, with Recoder's tools over MCP. See {@link ClaudeCodeRun}. */
	async openRun(options: AgentRunOptions): Promise<AgentRun> {
		const path = this.find();

		if (!path) throw new LlmError(0, `Claude Code is not installed. Install it with: ${INSTALL}`);

		return ClaudeCodeRun.open({ path, env: this.env, running: this.running, scratch: this.scratch }, options);
	}

	/**
	 * One model call. The prompt goes in on stdin and the system prompt in a file, since a review's diff can
	 * pass the kernel's per-argument limit. Text streams to `onToken`; usage comes from the final result line.
	 * A conversation's calls continue one saved session, see {@link sessionCall}.
	 */
	async complete(opts: ChatOptions, onToken?: (text: string) => void): Promise<string> {
		const path = this.find();

		if (!path) throw new LlmError(0, `Claude Code is not installed. Install it with: ${INSTALL}`);

		const deadline = callDeadline(opts);
		const scratch = await scratchDir(this.scratch, 'recoder-claude-code-');
		const systemFile = join(scratch, 'system.md');

		const cwd = await emptyDirectory(CLAUDE_CODE_EMPTY_DIR);
		const system = systemText(opts);
		const effort = effortArgs(opts);

		const session = sessionCall(
			{
				conversation: opts.conversation,
				model: opts.model,
				system,
				variant: effort.join(' '),
				turns: opts.messages.filter((m) => m.role !== 'system')
			},
			this.env,
			cwd
		);

		try {
			await writeFile(systemFile, system, { mode: 0o600 });

			const args = [
				...BASE_ARGS,
				...session.args,
				'--model',
				opts.model,
				...effort,
				'--system-prompt-file',
				systemFile
			];

			const text = await this.run(path, args, { cwd, session }, opts, deadline.signal, onToken);

			session.commit(text);

			return text;
		} catch (error) {
			session.fail();
			throw deadline.failure(error, 'Claude Code request failed.');
		} finally {
			await removeScratchDir(this.scratch, scratch);
		}
	}

	/** Kill every running call's process group and delete its system prompt file and saved sessions; synchronous, for exit. */
	stop(): void {
		super.stop();
		sweepSessions();
	}

	protected find(): string | null {
		return findCli({ pin: 'RECODER_CLAUDE_BIN', command: 'claude', installed: ['.local', 'bin', 'claude'] }, this.env);
	}

	/**
	 * Run the CLI in an empty directory, feed it the prompt and read its reply. See {@link streamCli} for how an
	 * abort or a runaway output stops it.
	 */
	private async run(
		path: string,
		args: string[],
		where: { cwd: string; session: SessionCall },
		opts: ChatOptions,
		signal: AbortSignal,
		onToken: ((text: string) => void) | undefined
	): Promise<string> {
		const reader = new ReplyReader({
			onText: onToken,
			onThinking: opts.onReasoning,
			onApiKeySource: (source) => {
				this.apiKeySource = source;
				if (this.status) this.status.apiKeySource = source;
				opts.onApiKeySource?.(source);
			}
		});

		const dump = new FailedCallDump(this.env);

		const lines = new LineSplitter((line) => {
			dump.add(line);
			reader.line(line);
		});

		const input = claudeCodeInput(where.session.prompt, where.session.images);

		try {
			const exit = await streamCli({
				argv: [path, ...args, ...input.args],
				cwd: where.cwd,
				env: claudeCodeEnv(this.env),
				stdin: input.stdin,
				signal,
				maxOutputBytes: CLI_OUTPUT_CAP_BYTES,
				onOutput: lines.push,
				running: this.running,
				name: this.name
			});

			lines.end();

			return reader.finish(opts.onUsage, exit);
		} catch (error) {
			dump.write(opts.model, error);
			throw error;
		}
	}

	protected childEnv(): Record<string, string> {
		return claudeCodeEnv(this.env);
	}

	protected configDir(): string {
		return claudeConfigDir(this.env);
	}

	/**
	 * The sign-in state. Once the CLI was found signed in, a check joins the status call already running, if any,
	 * and answers with that state when the call takes past {@link SIGN_IN_WAIT_MS}. The first check joins a running
	 * call too, and waits for it. While the last answer was signed out, a check starts a call of its own and waits:
	 * the person may have just signed in, after the running call asked.
	 */
	protected signIn(path: string): Promise<SignIn> {
		const known = this.signedInAs;

		if (known?.signedIn) return within(this.signInCall ?? this.startSignIn(path), SIGN_IN_WAIT_MS, known);

		return known ? this.startSignIn(path) : (this.signInCall ?? this.startSignIn(path));
	}

	/** Starts a status call, which checks that may take an older answer join until it ends. */
	private startSignIn(path: string): Promise<SignIn> {
		const call: Promise<SignIn> = this.checkSignIn(path, ++this.callsStarted).finally(() => {
			if (this.signInCall === call) this.signInCall = null;
		});

		this.signInCall = call;

		return call;
	}

	/**
	 * One status call. An answer it understood is kept and put on the status, for a check that stopped waiting.
	 * A call that ends after a newer one answered gives that newer answer, so a stale one never lands.
	 */
	private async checkSignIn(path: string, id: number): Promise<SignIn> {
		const found = await this.readSignIn(path);

		if (found.signedIn === null) return found;
		if (id < this.keptCall && this.signedInAs) return this.signedInAs;

		this.keptCall = id;
		this.signedInAs = found;
		if (this.status?.installed && !this.status.error) Object.assign(this.status, found);

		return found;
	}

	/** `claude auth status --json` exits 1 when signed out; only its `loggedIn` and `authMethod` fields are read. */
	private async readSignIn(path: string): Promise<SignIn> {
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
