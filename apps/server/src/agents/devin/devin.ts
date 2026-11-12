import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentStatus, ModelEntry } from '@recoder/shared';
import { LlmError } from '../../models/llm/errors';
import type { ChatOptions } from '../../models/llm/types';
import { callDeadline, emptyDirectory, findCli, removeScratchDir, scratchDir, stopOnShutdown } from '../cli-process';
import { promptText, systemText } from '../cli-prompt';
import { CLI_OUTPUT_CAP_BYTES, streamCli } from '../cli-stream';
import { SessionCliAgent } from '../session-run';
import type { AgentModelSettings, AgentRun, AgentRunOptions } from '../contract';
import { parseDevinModels } from './devin-models';
import { DEVIN_LOGIN, exitError, readExport, tokenUsage, type DevinExport } from './devin-output';
import { devinEnv, removeToolFreeHome, toolFreeHome } from './devin-process';
import { DevinRun, DEVIN_PRINT_ARGS } from './devin-run';

const INSTALL = 'curl -fsSL https://cli.devin.ai/install.sh | bash';

const STATUS_TIMEOUT_MS = 10_000;

const MODELS_TIMEOUT_MS = 20_000;

/**
 * A model that tries a tool anyway gets a refusal, which ends the turn with no text. The session is resumed with
 * this note, which makes it answer in text; a resumed session reports its whole token total, so usage is counted
 * once, from the last export.
 */
const TOOL_REFUSED_NUDGE =
	'That tool is unavailable and nothing can be run. Answer in plain text now, without any tool.';

const TOOL_RETRIES = 2;

/**
 * Devin, run as one `devin -p` process per model call.
 *
 * The CLI signs in itself. Recoder never reads its credential file; it runs the CLI without the server's keys
 * in its environment and under a config that denies every tool, and reads what the CLI prints and exports.
 */
export class DevinAgent extends SessionCliAgent {
	readonly id = 'devin';
	readonly name = 'Devin';
	readonly install = INSTALL;
	readonly login = DEVIN_LOGIN;
	/** Each call runs one CLI process, so four run at once unless `RECODER_DEVIN_CONCURRENCY` says otherwise. */
	readonly processCeiling = { env: 'RECODER_DEVIN_CONCURRENCY', fallback: 4 };
	readonly signInFix = `Sign in with \`${DEVIN_LOGIN}\`, or pick another model in Recoder settings.`;

	/**
	 * The account's models, from `devin models list`; throws when the CLI is missing or the list is empty. When `signal`
	 * aborts, the CLI process is killed and the call rejects.
	 */
	async models(signal?: AbortSignal): Promise<ModelEntry[]> {
		const path = this.find();

		if (!path) throw new LlmError(0, `Devin is not installed. Install it with: ${INSTALL}`);

		const listed = parseDevinModels((await this.output(path, ['models', 'list'], MODELS_TIMEOUT_MS, signal)).stdout);

		if (!listed.length) throw new LlmError(0, 'Devin listed no models.');

		return listed;
	}

	/** Devin names the effort in the model id (`swe-2-high`), so a model has no effort of its own to set. */
	modelSettings(): AgentModelSettings {
		return {};
	}

	/** A run in which Devin is the agent, with Recoder's tools over MCP. See {@link DevinRun}. */
	async openRun(options: AgentRunOptions): Promise<AgentRun> {
		const path = this.find();

		if (!path) throw new LlmError(0, `Devin is not installed. Install it with: ${INSTALL}`);

		return DevinRun.open(this.sessionHost(path), options);
	}

	/**
	 * One model call. The system prompt and the turns go in a file, since a review's diff can pass the kernel's
	 * per-argument limit. The CLI prints the reply when it ends; usage comes from the conversation it exports,
	 * which is then deleted from its session store along with the files here.
	 */
	async complete(opts: ChatOptions, onToken?: (text: string) => void): Promise<string> {
		const path = this.find();

		if (!path) throw new LlmError(0, `Devin is not installed. Install it with: ${INSTALL}`);

		const deadline = callDeadline(opts);
		const scratch = await scratchDir(this.scratch, 'recoder-devin-');
		const promptFile = join(scratch, 'prompt.md');
		const exportFile = join(scratch, 'export.json');
		const cwd = await emptyDirectory('devin-empty');
		let session: string | undefined;

		try {
			const system = systemText(opts);
			const turns = opts.messages.filter((m) => m.role !== 'system');

			await writeFile(promptFile, `${system}\n\n${promptText(turns)}`, { mode: 0o600 });

			const env = { ...devinEnv(this.env), XDG_CONFIG_HOME: await toolFreeHome(this.env) };
			let text = '';
			let exported: DevinExport | null = null;

			for (let attempt = 0; attempt <= TOOL_RETRIES && !text.trim(); attempt++) {
				if (attempt > 0) await writeFile(promptFile, TOOL_REFUSED_NUDGE, { mode: 0o600 });

				const args = [...DEVIN_PRINT_ARGS, '--prompt-file', promptFile, '--model', opts.model, '--export', exportFile];

				if (session) args.push('--resume', session);

				text = await this.run(path, args, { cwd, env }, deadline.signal, onToken);
				exported = await readExport(exportFile);
				session = exported?.session_id ?? session;
			}

			if (exported?.final_metrics) opts.onUsage?.(tokenUsage(exported.final_metrics));

			if (!text.trim()) throw new LlmError(0, 'Devin ended without a reply.');

			return text;
		} catch (error) {
			session ??= (await readExport(exportFile))?.session_id;
			throw deadline.failure(error, 'Devin request failed.');
		} finally {
			await removeScratchDir(this.scratch, scratch);
			if (session) await this.forget(path, session);
		}
	}

	/** Also deletes the tool-free config. */
	override stop(): void {
		super.stop();
		removeToolFreeHome();
	}

	protected find(): string | null {
		return findCli({ pin: 'RECODER_DEVIN_BIN', command: 'devin', installed: ['.local', 'bin', 'devin'] }, this.env);
	}

	protected childEnv(): Record<string, string> {
		return devinEnv(this.env);
	}

	/** `devin auth status` exits 0 when signed in. */
	protected async signIn(path: string): Promise<Pick<AgentStatus, 'signedIn'>> {
		return { signedIn: (await this.output(path, ['auth', 'status'], STATUS_TIMEOUT_MS)).code === 0 };
	}

	/**
	 * Deletes the session the CLI saved for a call, which holds the review's prompt, and resolves once `devin rm`
	 * has exited or run out of time, so a stalled `rm` never holds a review. Its exit code is not read: a session
	 * the CLI never saved has nothing to delete.
	 */
	protected async forget(path: string, session: string): Promise<void> {
		await this.output(path, ['rm', session, '--force'], STATUS_TIMEOUT_MS);
	}

	/** Run the CLI in an empty directory and read its reply. See {@link streamCli} for how an abort stops it. */
	private async run(
		path: string,
		args: string[],
		where: { cwd: string; env: Record<string, string> },
		signal: AbortSignal,
		onToken: ((text: string) => void) | undefined
	): Promise<string> {
		let text = '';

		const exit = await streamCli({
			argv: [path, ...args],
			cwd: where.cwd,
			env: where.env,
			stdin: null,
			signal,
			maxOutputBytes: CLI_OUTPUT_CAP_BYTES,
			onOutput: (piece) => {
				text += piece;
				onToken?.(piece);
			},
			running: this.running,
			name: this.name
		});

		if (exit.code !== 0) throw exitError(exit, text);

		return text;
	}
}

export const devin = new DevinAgent();

stopOnShutdown('devin', () => devin.stop());
