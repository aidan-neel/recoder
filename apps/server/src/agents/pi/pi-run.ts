import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { JSON_MODE_INSTRUCTION } from '../../models/llm/request-fields';
import { removeScratchDir } from '../cli-process';
import type { AgentPromptOptions, AgentReply, AgentRunOptions } from '../contract';
import { ProcessRun } from '../process-run';
import { runPiCall, type PiHost } from './pi-call';
import { PI_DEFAULT_EFFORT, printArgs } from './pi-process';
import { makeScratch, type PiScratch } from './pi-scratch';
import { SessionTail } from './pi-session';
import { NO_TOOLS_ARGS, writeToolBridge } from './pi-tool-bridge';

/** What a run needs of the adapter: where Pi runs, and the set of scratch dirs its `stop` deletes. */
export interface PiRunHost extends Omit<PiHost, 'cwd'> {
	scratch: Set<string>;
}

/**
 * Pi as the agent: one `pi -p` process per prompt, each continuing the run's own session file. Recoder's tools reach
 * it through an extension that forwards each call to the run's MCP slot (see `pi-tool-bridge.ts`); the review gate
 * behind it decides what each call may do. The model calls Pi saves to the session are reported as steps while the
 * prompt runs.
 */
export class PiRun extends ProcessRun {
	private readonly session: SessionTail;
	/** The working directory: empty, inside the scratch dir, so the run reaches no file but through its tools. */
	private readonly cwd: string;
	private toolArgs: readonly string[] = NO_TOOLS_ARGS;

	private constructor(
		private readonly host: PiRunHost,
		options: AgentRunOptions,
		private readonly files: PiScratch
	) {
		super(options);
		this.session = new SessionTail(files.session, options.onEvent);
		this.cwd = join(files.root, 'work');
	}

	/** Opens a run in a new scratch dir; a run that cannot be set up is closed again, giving its tool slot back. */
	static async open(host: PiRunHost, options: AgentRunOptions): Promise<PiRun> {
		const run = new PiRun(host, options, await makeScratch(host.scratch, 'recoder-pi-run-', options.system));

		return run.setUp().catch(async (error: unknown) => {
			await run.close();
			throw error;
		});
	}

	/**
	 * Runs the agent on `text` until it answers. Pi cannot enforce a schema, so JSON is asked for in words. Its tools
	 * stay listed on the final turn, since a session that used them must still declare them; the gate refuses them.
	 */
	async prompt(text: string, options: AgentPromptOptions): Promise<AgentReply> {
		const deadline = this.begin(options.timeoutMs);
		const { model, reasoningEffort } = this.options;

		const args = printArgs({
			model,
			thinking: reasoningEffort ?? PI_DEFAULT_EFFORT,
			systemFile: this.files.system,
			sessionFile: this.files.session,
			toolArgs: this.toolArgs
		});

		try {
			const outcome = await runPiCall(
				{ ...this.host, cwd: this.cwd },
				{
					args,
					stdin: options.schema ? `${text}\n\n${JSON_MODE_INSTRUCTION}` : text,
					session: this.session,
					signal: deadline.signal
				}
			);

			return { text: outcome.text, error: outcome.error };
		} catch (error) {
			return { text: '', error: deadline.failure(error, 'Pi run failed.') };
		}
	}

	/** Deletes the run's scratch dir, which holds the only session Pi saved for it. */
	protected override async cleanUp(): Promise<void> {
		await removeScratchDir(this.host.scratch, this.files.root);
	}

	/** Makes the empty working directory and, when the run has tools, writes the tool bridge. */
	private async setUp(): Promise<this> {
		await mkdir(this.cwd, { recursive: true });

		if (this.lease) this.toolArgs = await writeToolBridge(this.files.root, this.lease, this.options.tools);

		return this;
	}
}
