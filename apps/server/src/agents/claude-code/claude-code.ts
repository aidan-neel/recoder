import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { within, type AgentStatus, type ModelEntry } from '@recoder/shared';
import { LlmError } from '../../models/llm/errors';
import type { ChatOptions } from '../../models/llm/types';
import {
	CliAgent,
	callDeadline,
	emptyDirectory,
	findCli,
	killGroup,
	killOnAbort,
	stopOnShutdown
} from '../cli-process';
import { systemText } from '../cli-prompt';
import { claudeCodeEfforts, claudeCodeModels } from './claude-code-models';
import { FailedCallDump } from './claude-code-debug';
import { claudeCodeEnv } from './claude-code-process';
import { ReplyReader } from './claude-code-reply';
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
export class ClaudeCodeAgent extends CliAgent {
	readonly id = 'claude-code';
	readonly name = 'Claude Code';
	readonly install = INSTALL;
	readonly login = LOGIN;

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

	/**
	 * One model call. The prompt goes in on stdin and the system prompt in a file, since a review's diff can
	 * pass the kernel's per-argument limit. Text streams to `onToken`; usage comes from the final result line.
	 * A conversation's calls continue one saved session, see {@link sessionCall}.
	 */
	async complete(opts: ChatOptions, onToken?: (text: string) => void): Promise<string> {
		const path = this.find();

		if (!path) throw new LlmError(0, `Claude Code is not installed. Install it with: ${INSTALL}`);

		const deadline = callDeadline(opts);
		const scratch = await mkdtemp(join(tmpdir(), 'recoder-claude-code-'));
		const systemFile = join(scratch, 'system.md');

		const cwd = await emptyDirectory('claude-code-empty');
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

		this.scratch.add(scratch);

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
			this.scratch.delete(scratch);
			await rm(scratch, { recursive: true, force: true });
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
	 * Spawn the CLI in an empty directory, in its own process group, feed it the prompt and read its reply. When
	 * `signal` aborts the group is killed and the call rejects at once, without waiting for its pipes to close;
	 * whatever the CLI started is killed with it once the call ends either way.
	 */
	private async run(
		path: string,
		args: string[],
		where: { cwd: string; session: SessionCall },
		opts: ChatOptions,
		signal: AbortSignal,
		onToken: ((text: string) => void) | undefined
	): Promise<string> {
		const proc = Bun.spawn([path, ...args], {
			cwd: where.cwd,
			env: claudeCodeEnv(this.env),
			detached: true,
			stdin: new Blob([where.session.prompt]),
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

		const dump = new FailedCallDump(this.env);

		this.running.add(proc);

		const { stopped, release } = killOnAbort(proc, signal);

		try {
			const [, stderr, code] = await Promise.race([
				Promise.all([
					readLines(proc.stdout, (line) => {
						dump.add(line);
						reader.line(line);
					}),
					new Response(proc.stderr).text(),
					proc.exited
				]),
				stopped
			]);

			return reader.finish(opts.onUsage, { code, stderr });
		} catch (error) {
			dump.write(opts.model, error);
			throw error;
		} finally {
			release();
			this.running.delete(proc);
			killGroup(proc);
		}
	}

	protected childEnv(): Record<string, string> {
		return claudeCodeEnv(this.env);
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
