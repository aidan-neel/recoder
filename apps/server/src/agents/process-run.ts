import { callDeadline, type CallDeadline } from './cli-process';
import type { AgentPromptOptions, AgentReply, AgentRun, AgentRunOptions } from './contract';
import { toolHost, type ToolLease } from './tools/mcp-host';

/**
 * What every run that starts one CLI process per prompt shares: its tool slot, leased when the run may use tools
 * and given back when it closes, and the prompt in progress, which `abort` stops. Each prompt's deadline ends
 * with the run's signal, with `abort`, or after its own time.
 */
export abstract class ProcessRun implements AgentRun {
	protected readonly lease: ToolLease | null;
	private stop: AbortController | null = null;

	protected constructor(protected readonly options: AgentRunOptions) {
		this.lease = options.tools.length ? toolHost.lease(options.tools, options.runTool, options.onEvent) : null;
	}

	abstract prompt(text: string, options: AgentPromptOptions): Promise<AgentReply>;

	async abort(): Promise<void> {
		this.stop?.abort();
	}

	async close(): Promise<void> {
		this.stop?.abort();
		this.lease?.release();
		await this.cleanUp();
	}

	/** Starts a prompt and returns its deadline. */
	protected begin(timeoutMs: number): CallDeadline {
		const stop = new AbortController();

		this.stop = stop;

		return callDeadline({ timeoutMs, signal: AbortSignal.any([this.options.signal, stop.signal]) });
	}

	/** Deletes what the run left behind (scratch files, saved sessions); nothing by default. */
	protected async cleanUp(): Promise<void> {}
}
