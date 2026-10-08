import type { ToolRunner } from '../../../agents/opencode/opencode-mcp.js';
import { formatToolResults } from '../../../evidence/evidence.js';
import { toolAction } from '../../../evidence/native-tools.js';
import type { RetrievalAction, ToolResult } from '../../../evidence/types.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import { runDelegation } from './delegation.js';
import type { JsonAgentOptions } from './options.js';

/** Heads a developer note that reaches the agent with a tool result, mid-run. */
const DISCUSSION_NOTE = 'The developer said this since you started (consider it with the review evidence):';

export const FINAL_TURN_NOTE =
	'This is your final turn. Do not call any more tools. Give your final result now with the evidence you have.';

/** Sent with the results of the last step that may use tools, so the model does not spend a step being refused. */
const LAST_TOOLS_NOTE = '\n\nThis was your last step with tools. Give your final result in your next step.';

function refusal(text: string): { text: string; isError: boolean } {
	return { text, isError: true };
}

/**
 * Stands between the model's tool calls and the review's evidence. OpenCode
 * decides when the model calls a tool; this decides whether the call still
 * fits the agent's turns, runs it through the evidence store (so it is
 * sandboxed, recorded and shown on the dashboard), and counts what the agent did.
 */
export class ToolGate<T> {
	/** Steps in which the agent retrieved something, and commands it ran. */
	retrievals = 0;
	runs = 0;

	/** A read that already failed was asked again: asking more won't go differently. */
	stuck = false;

	/** Calls being executed now, so a long sandbox run is not mistaken for a stalled model. */
	inFlight = 0;

	private stepCalls = 0;
	private stepRuns = 0;
	private stepChars = 0;
	private readonly failedReads = new Set<string>();
	private queue: Promise<unknown> = Promise.resolve();
	private sentDiscussion: string;

	constructor(
		private readonly opts: JsonAgentOptions<T>,
		private readonly agentId: string,
		private readonly turns: { isFinal: () => boolean; nextIsFinal: () => boolean },
		sentDiscussion: string
	) {
		this.sentDiscussion = sentDiscussion;
	}

	/** A model step ended: the next step's allowances start over. */
	stepDone(): void {
		this.stepCalls = 0;
		this.stepRuns = 0;
		this.stepChars = 0;
	}

	/**
	 * Runs a tool call. A model may send several calls in one step; they run
	 * one after another in the order sent, so a file is written before the
	 * command that runs it.
	 */
	readonly run: ToolRunner = (name, args) => {
		const next = this.queue.then(() => this.call(name, args));

		this.queue = next.catch(() => {});

		return next;
	};

	private async call(name: string, args: unknown): Promise<{ text: string; isError: boolean }> {
		const { opts } = this;

		if (opts.signal.aborted) return refusal('The review was stopped.');
		if (this.turns.isFinal()) return refusal(FINAL_TURN_NOTE);

		const action = toolAction(name, args, { exec: Boolean(opts.exec), delegate: Boolean(opts.delegate) });

		if (!action) return refusal(`There is no tool named ${name}.`);

		if (this.stepCalls >= REVIEW_POLICY.maxRetrievalsPerTurn)
			return refusal(
				`At most ${REVIEW_POLICY.maxRetrievalsPerTurn} tool calls per step. Call this one in your next step.`
			);

		if (action.action === 'run' && this.stepRuns >= REVIEW_POLICY.maxRunsPerTurn)
			return refusal(`At most ${REVIEW_POLICY.maxRunsPerTurn} runs per step. Run this one in your next step.`);

		const key = JSON.stringify(action);
		const read = !['run', 'writeFile', 'delegate'].includes(action.action);

		if (read && this.failedReads.has(key)) {
			this.stuck = true;
			opts.onLog?.(`${opts.label} repeated a request that failed; asking for its answer`);

			return refusal(`This exact request already failed. ${FINAL_TURN_NOTE}`);
		}

		if (this.stepCalls++ === 0) this.retrievals++;

		if (action.action === 'run') {
			this.stepRuns++;
			this.runs++;
		}

		opts.onProgress?.('retrieval', 0, `Reading repository evidence for ${opts.label}`);
		this.inFlight++;

		try {
			const result = await this.execute(action);

			this.runs += result.runs ?? 0;
			this.stepChars += result.content.length;
			if (!result.ok && read) this.failedReads.add(key);

			if (result.ok && result.path)
				opts.onLog?.(`Reading ${result.path}${result.startLine ? `:${result.startLine}` : ''}`);

			const closing = this.turns.nextIsFinal() ? LAST_TOOLS_NOTE : '';

			return { text: formatToolResults([result]) + this.discussionNote() + closing, isError: false };
		} finally {
			this.inFlight--;
		}
	}

	/** A delegation goes to the agent's worker; every other action is one evidence call within the step's budget. */
	private async execute(action: RetrievalAction): Promise<ToolResult> {
		const { opts } = this;

		if (action.action === 'delegate') return runDelegation(opts, action);

		const [result] = await opts.evidence.executeRound(
			[action],
			opts.signal,
			opts.onTool,
			1,
			this.agentId,
			this.stepChars
		);

		return result;
	}

	/** What the developer said since it was last passed on, once. */
	private discussionNote(): string {
		const discussion = this.opts.getDiscussion?.() ?? '';

		if (!discussion || discussion === this.sentDiscussion) return '';

		this.sentDiscussion = discussion;

		return `\n\n${DISCUSSION_NOTE}\n${discussion}`;
	}
}
