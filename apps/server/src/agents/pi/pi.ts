import { homedir } from 'node:os';
import { join } from 'node:path';
import { supportedEffort, type AgentStatus, type ModelEntry, type ReasoningEffort } from '@recoder/shared';
import { LlmError } from '../../models/llm/errors';
import { turnImages } from '../../models/llm/message-images';
import type { ChatOptions } from '../../models/llm/types';
import {
	CliAgent,
	callDeadline,
	cliOutput,
	emptyDirectory,
	findCli,
	removeScratchDir,
	stopOnShutdown
} from '../cli-process';
import { promptText, systemText } from '../cli-prompt';
import type { AgentModelSettings, AgentRun, AgentRunOptions, AgentSetup } from '../contract';
import { writeImageFiles } from '../image-files';
import { runPiCall } from './pi-call';
import { parsePiModels } from './pi-models';
import { PI_LOGIN, tokenUsage, totalUsage } from './pi-output';
import { PI_DEFAULT_EFFORT, PI_EFFORTS, PI_ISOLATION_ARGS, piEnv, printArgs } from './pi-process';
import { PiRun } from './pi-run';
import { makeScratch } from './pi-scratch';
import { SessionTail } from './pi-session';
import { NO_TOOLS_ARGS } from './pi-tool-bridge';

const INSTALL = 'npm install -g @mariozechner/pi-coding-agent';

const COMMAND_TIMEOUT_MS = 20_000;

const VERSION = /\b(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\b/;

/**
 * `--list-models` with nothing loaded that could run code or reach the network, and no session saved: it lists
 * the models of every provider Pi has a sign-in or a key for.
 */
const LIST_ARGS = ['--list-models', ...PI_ISOLATION_ARGS, '--no-session'];

/**
 * Pi, the coding agent of pi-mono, run as one `pi -p` process per model call.
 *
 * Pi signs in itself (`/login` in its interactive mode) and keeps the sign-in in its agent dir, which Recoder never
 * reads. Recoder runs it without the server's keys in its environment, with every built-in tool, extension, skill
 * and context file off, and reads what it prints and saves to the call's own session file.
 */
export class PiAgent extends CliAgent {
	readonly id = 'pi';
	readonly name = 'Pi';
	/** Images go in as `@file` arguments, which Pi attaches to the prompt it reads on stdin. */
	readonly readsImages = true;
	readonly install = INSTALL;
	readonly login = PI_LOGIN;
	/** Each call runs one CLI process, so four run at once unless `RECODER_PI_CONCURRENCY` says otherwise. */
	readonly processCeiling = { env: 'RECODER_PI_CONCURRENCY', fallback: 4 };
	readonly signInFix = 'Sign in by running `pi` and typing /login, or pick another model in Recoder settings.';
	/**
	 * The setup Settings runs: the npm install. There is no headless sign-in — Pi's only one is the `/login`
	 * slash command of its interactive mode — so `signIn` stays null.
	 */
	readonly setup: AgentSetup = {
		install: { argv: ['npm', 'install', '-g', '@mariozechner/pi-coding-agent'] },
		signIn: null
	};

	/**
	 * The models Pi can run now, from `pi --list-models`; throws when the CLI is missing or lists none, which is how
	 * a missing sign-in shows. When `signal` aborts, the CLI is killed and the call rejects.
	 */
	async models(signal?: AbortSignal): Promise<ModelEntry[]> {
		const listed = parsePiModels(await this.output(this.requirePath(), LIST_ARGS, signal));

		if (!listed.length) throw new LlmError(0, `Pi listed no models. Sign in: ${PI_LOGIN}`);

		return listed;
	}

	/** A model gets the picked thinking level when Pi has it, else Pi's default; Pi lowers it for a model that lacks it. */
	modelSettings(_model: string, requested: ReasoningEffort | undefined): AgentModelSettings {
		return { reasoningEffort: supportedEffort(requested ?? PI_DEFAULT_EFFORT, PI_EFFORTS, PI_DEFAULT_EFFORT) };
	}

	/**
	 * One model call with every tool off. The system prompt goes in a file and the turns on stdin, since a review's
	 * diff can pass the kernel's per-argument limit. The answer streams to `onToken` as Pi prints it; usage comes from
	 * the session file, which is deleted with the scratch dir.
	 */
	async complete(opts: ChatOptions, onToken?: (text: string) => void): Promise<string> {
		const path = this.requirePath();
		const deadline = callDeadline(opts);
		const files = await makeScratch(this.scratch, 'recoder-pi-', systemText(opts));

		try {
			const thinking = opts.thinking === false ? 'off' : opts.reasoningEffort;
			const turns = opts.messages.filter((m) => m.role !== 'system');

			const args = printArgs({
				model: opts.model,
				thinking,
				systemFile: files.system,
				sessionFile: files.session,
				toolArgs: NO_TOOLS_ARGS,
				images: await writeImageFiles(files.root, turnImages(turns))
			});

			const session = new SessionTail(files.session, (event) => {
				if (event.type === 'reasoning') opts.onReasoning?.(event.delta);
			});

			const outcome = await runPiCall(
				{ path, env: this.env, running: this.running, cwd: await emptyDirectory('pi-empty') },
				{
					args,
					stdin: promptText(turns),
					session,
					signal: deadline.signal,
					onText: onToken
				}
			);

			if (outcome.usages.length) opts.onUsage?.(tokenUsage(totalUsage(outcome.usages)));
			if (outcome.error) throw outcome.error;

			return outcome.text;
		} catch (error) {
			throw deadline.failure(error, 'Pi request failed.');
		} finally {
			await removeScratchDir(this.scratch, files.root);
		}
	}

	/** A run in which Pi is the agent, with Recoder's tools through its extension. See {@link PiRun}. */
	async openRun(options: AgentRunOptions): Promise<AgentRun> {
		return PiRun.open(
			{ path: this.requirePath(), env: this.env, running: this.running, scratch: this.scratch },
			options
		);
	}

	/**
	 * Pi answers `--version` on stderr when its stdin is not a terminal, where the shared version probe does not look.
	 * When that probe found none, the version is read from stderr here, and the sign-in checked once it is found. The
	 * status is the cached object, so the cache keeps what this adds. A Pi that cannot be run here either keeps the
	 * error the shared check gave it.
	 */
	override async detect(refresh = false): Promise<AgentStatus> {
		const cached = this.status;
		const status = await super.detect(refresh);

		if (status === cached || status.version || !status.path) return status;

		const printed = await this.output(status.path, ['--version']).catch(() => '');
		const version = VERSION.exec(printed)?.[1];

		if (!version) return status;

		return Object.assign(status, { version, error: null }, await this.signIn(status.path));
	}

	protected find(): string | null {
		return findCli({ pin: 'RECODER_PI_BIN', command: 'pi', installed: ['.local', 'bin', 'pi'] }, this.env);
	}

	protected childEnv(): Record<string, string> {
		return piEnv(this.env);
	}

	/** Pi's agent dir, where `/login` leaves its sign-in: `PI_CODING_AGENT_DIR`, else `~/.pi/agent`. */
	protected configDir(): string {
		return this.env.PI_CODING_AGENT_DIR || join(this.env.HOME || homedir(), '.pi', 'agent');
	}

	/** Pi has no status command; it is signed in when it lists a model, which only providers it can call give. */
	protected async signIn(path: string): Promise<Pick<AgentStatus, 'signedIn'>> {
		try {
			return { signedIn: parsePiModels(await this.output(path, LIST_ARGS)).length > 0 };
		} catch {
			return { signedIn: null };
		}
	}

	private requirePath(): string {
		const path = this.find();

		if (!path) throw new LlmError(0, `Pi is not installed. Install it with: ${INSTALL}`);

		return path;
	}

	/**
	 * What a short command prints, run in an empty directory to its end; killed after a while, or when `signal` aborts.
	 * Pi prints a listing or its version on stderr when its stdin is not a terminal, so both streams are read.
	 */
	private async output(path: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
		const { code, stdout, stderr } = await cliOutput([path, ...args], {
			env: piEnv(this.env),
			cwd: await emptyDirectory('pi-empty'),
			timeoutMs: COMMAND_TIMEOUT_MS,
			signal
		});

		if (code !== 0) throw new LlmError(0, `Pi exited with code ${code} on \`pi ${args[0]}\`.`);

		return `${stdout}\n${stderr}`;
	}
}

export const pi = new PiAgent();

stopOnShutdown('pi', () => pi.stop());
