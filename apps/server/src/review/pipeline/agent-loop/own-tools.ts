import type { AgentEvent, AgentWorkspace } from '../../../agents/contract.js';
import { agentById } from '../../../agents/registry.js';
import { agentTools } from '../../../env.js';
import { copyCheckoutFor, removeCheckoutCopy } from '../../../sandbox/agent-copy.js';
import type { JsonAgentOptions } from './options.js';

/**
 * Whether an agent works with its CLI's own tools in place of Recoder's (`RECODER_AGENT_TOOLS=cli`): only one
 * that runs code, on a CLI that can work in a checkout, in a review that has a checkout to copy. An agent that
 * only reads keeps Recoder's tools, because its findings are checked against the reads it cites.
 */
export function worksWithOwnTools<T>(opts: Pick<JsonAgentOptions<T>, 'config' | 'exec' | 'evidence'>): boolean {
	return (
		agentTools() === 'cli' &&
		Boolean(opts.exec) &&
		Boolean(opts.evidence.exec && opts.evidence.revision) &&
		agentById(opts.config.provider)?.ownTools === true
	);
}

/**
 * One agent's work with its CLI's own tools: the private copy of the checkout it works in, and what it did
 * there. The CLI runs the tools, so nothing passes Recoder's gate; this records each command the CLI's shell ran
 * as the agent's evidence and counts its steps with tool calls and its runs, as the gate does for Recoder's tools.
 */
export class OwnToolWork<T> {
	/** Steps in which the agent called a tool, and commands it ran. */
	retrievals = 0;
	runs = 0;

	private stepCalls = 0;
	private copy: string | null = null;

	constructor(
		private readonly opts: JsonAgentOptions<T>,
		private readonly agentId: string
	) {}

	/** Copies the checkout for this agent, once setup is done and no command is changing it. */
	async open(): Promise<AgentWorkspace> {
		const exec = this.opts.evidence.exec;

		if (!exec) throw new Error('an agent on its own tools needs a checkout that can run code');

		this.copy = await exec.whileIdle(() => copyCheckoutFor(exec.layout, this.agentId));

		return { directory: this.copy, exec: true };
	}

	/** The commit the change is compared with, which the agent reads the diff from. */
	get mergeBaseSha(): string {
		return this.opts.evidence.revision?.mergeBaseSha ?? '';
	}

	/** A model step ended: the next step's first tool call counts as a new retrieval. */
	stepDone(): void {
		this.stepCalls = 0;
	}

	readonly onEvent = (event: AgentEvent): void => {
		if (event.type === 'tool-call' && this.stepCalls++ === 0) this.retrievals++;

		if (event.type === 'command') {
			this.runs++;
			this.opts.evidence.recordAgentRun(event, this.agentId, this.opts.onTool);
		}
	};

	async close(): Promise<void> {
		if (this.copy) await removeCheckoutCopy(this.copy);
	}
}
