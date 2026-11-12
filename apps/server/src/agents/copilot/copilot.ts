import { statSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { supportedEffort, type AgentStatus, type ModelEntry, type ReasoningEffort } from '@recoder/shared';
import { LlmError } from '../../models/llm/errors';
import type { ChatOptions } from '../../models/llm/types';
import type { AgentModelSettings, AgentRun, AgentRunOptions } from '../contract';
import {
	CliAgent,
	callDeadline,
	emptyDirectory,
	findCli,
	removeScratchDir,
	scratchDir,
	stopOnShutdown
} from '../cli-process';
import { promptText, systemText } from '../cli-prompt';
import { CLI_OUTPUT_CAP_BYTES, LineSplitter, streamCli } from '../cli-stream';
import { AUTO_MODEL, copilotEfforts, copilotModels, effortArgs } from './copilot-models';
import { EventReader, GH_LOGIN, readUsage } from './copilot-output';
import { copilotEnv, copilotEnvWithHome } from './copilot-process';
import { CopilotRun, NO_TOOLS_ARGS, PROMPT_ARGS } from './copilot-run';

const INSTALL = 'npm install -g @github/copilot';

/** How much of a candidate file is read to tell VS Code's launcher shim from the CLI. */
const SHIM_PROBE_BYTES = 4096;

/** The marker in the shim script VS Code puts on PATH as `copilot`; the CLI is a binary that never names it. */
const SHIM_MARKER = 'vscode-copilot-launcher';

/**
 * Whether `path` is VS Code's `copilot` shim rather than the CLI: the shim installs under a `copilot-shim`
 * directory and is a small shell script that names its launcher, and the CLI is a binary with neither.
 */
function isShim(path: string): boolean {
	if (path.split(/[\\/]/).includes('copilot-shim')) return true;

	try {
		if (statSync(path).size > SHIM_PROBE_BYTES) return false;

		return readFileSync(path, 'utf8').slice(0, SHIM_PROBE_BYTES).includes(SHIM_MARKER);
	} catch {
		return false;
	}
}

/**
 * GitHub Copilot, run as one prompt-mode process per model call.
 *
 * The CLI signs in to the user's GitHub account: `gh auth login` or `COPILOT_GITHUB_TOKEN`, the one token
 * variable forwarded. Its own `copilot login` sign-in is invisible to a run, since every call gets an empty
 * scratch `COPILOT_HOME`; `GH_TOKEN`/`GITHUB_TOKEN` are the server's forge credentials and never cross. Recoder
 * never reads the CLI's credential files, runs it without the server's keys in its environment, and reads the
 * JSONL the CLI prints.
 */
export class CopilotAgent extends CliAgent {
	readonly id = 'copilot';

	readonly name = 'GitHub Copilot';

	readonly install = INSTALL;

	readonly login = GH_LOGIN;

	/** Each call runs one CLI process, so four run at once unless `RECODER_COPILOT_CONCURRENCY` says otherwise. */
	readonly processCeiling = { env: 'RECODER_COPILOT_CONCURRENCY', fallback: 4 };

	readonly signInFix = `Sign in with \`${GH_LOGIN}\` or set COPILOT_GITHUB_TOKEN, or pick another model in Recoder settings.`;

	/** The fixed list, offered whether or not the CLI is installed: it has no command that lists models. */
	override fixedModels(): ModelEntry[] {
		return copilotModels();
	}

	async models(): Promise<ModelEntry[]> {
		return copilotModels();
	}

	/**
	 * A model runs at the picked effort when it is one `--reasoning-effort` takes; with none picked, no flag is
	 * passed and the model runs at its own default, which the CLI documents as medium for most models. `auto`
	 * takes no effort, since the model it picks decides which levels it accepts.
	 */
	modelSettings(model: string, requested: ReasoningEffort | undefined): AgentModelSettings {
		if (model === AUTO_MODEL) return {};

		const { efforts, defaultEffort } = copilotEfforts();
		const effort = supportedEffort(requested, efforts, defaultEffort);

		return effort ? { reasoningEffort: effort } : {};
	}

	/** A run in which GitHub Copilot is the agent, with Recoder's tools over MCP. See {@link CopilotRun}. */
	async openRun(options: AgentRunOptions): Promise<AgentRun> {
		return CopilotRun.open(
			{ env: this.env, path: this.requirePath(), scratch: this.scratch, running: this.running },
			options
		);
	}

	/**
	 * One model call, all tools off, in an empty directory, under its own `COPILOT_HOME`. The prompt goes in on
	 * stdin, since a review's diff can pass the kernel's per-argument limit. Text streams as the CLI reports it;
	 * usage comes from the file the CLI writes at the end of the call.
	 */
	async complete(opts: ChatOptions, onToken?: (text: string) => void): Promise<string> {
		const path = this.requirePath();

		const deadline = callDeadline(opts);
		const scratch = await scratchDir(this.scratch, 'recoder-copilot-');
		const home = join(scratch, 'home');
		const usageFile = join(scratch, 'usage.json');
		const cwd = await emptyDirectory('copilot-empty');

		const reader = new EventReader((event) => {
			if (event.type === 'text') onToken?.(event.delta);
		});

		const lines = new LineSplitter(reader.line);

		try {
			await mkdir(home, { recursive: true });

			const system = systemText(opts);
			const turns = opts.messages.filter((m) => m.role !== 'system');

			const exit = await streamCli({
				argv: [
					path,
					...PROMPT_ARGS,
					...NO_TOOLS_ARGS,
					'--model',
					opts.model,
					...effortArgs(opts.model, opts.reasoningEffort),
					'--usage-output-file',
					usageFile
				],
				cwd,
				env: copilotEnvWithHome(this.env, home),
				stdin: `${system}\n\n${promptText(turns)}`,
				signal: deadline.signal,
				maxOutputBytes: CLI_OUTPUT_CAP_BYTES,
				onOutput: lines.push,
				running: this.running,
				name: this.name
			});

			lines.end();

			const usage = await readUsage(usageFile);

			if (usage) opts.onUsage?.(usage);

			const { text, error } = reader.finish(exit);

			if (error) throw error;

			if (!text.trim()) throw new LlmError(0, 'GitHub Copilot ended without a reply.');

			return text;
		} catch (error) {
			throw deadline.failure(error, 'GitHub Copilot request failed.');
		} finally {
			await removeScratchDir(this.scratch, scratch);
		}
	}

	/** The CLI's path, or the not-installed error every call and run shares. */
	private requirePath(): string {
		const path = this.find();

		if (!path) throw new LlmError(0, `GitHub Copilot is not installed. Install it with: ${INSTALL}`);

		return path;
	}

	protected find(): string | null {
		const path = findCli(
			{ pin: 'RECODER_COPILOT_BIN', command: 'copilot', installed: ['.local', 'bin', 'copilot'] },
			this.env
		);

		return path && !isShim(path) ? path : null;
	}

	protected childEnv(): Record<string, string> {
		return copilotEnv(this.env);
	}

	/**
	 * Nothing: the CLI has no command that reports sign-in state without making a model call (only `login`,
	 * which Recoder never runs), so the status leaves the state unknown and a signed-out call surfaces as the
	 * 401 that names the sign-in command.
	 */
	protected async signIn(): Promise<Partial<AgentStatus>> {
		return {};
	}
}

export const copilot = new CopilotAgent();

stopOnShutdown('copilot', () => copilot.stop());
