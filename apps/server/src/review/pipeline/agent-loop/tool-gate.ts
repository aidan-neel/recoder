import type { ToolRunner } from '../../../agents/contract.js';
import { formatToolResults } from '../../../evidence/evidence.js';
import { nativeToolNames, toolAction } from '../../../evidence/native-tools.js';
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
 * Stands between the model's tool calls and the review's evidence. The CLI
 * decides when the model calls a tool; this decides whether the call still
 * fits the agent's turns, runs it through the evidence store (so it is
 * sandboxed, recorded and shown on the dashboard), and counts what the agent did.
 */
export class ToolGate<T> {
	/** Steps in which the agent retrieved something, and commands it ran. */
	retrievals = 0;
	runs = 0;
	ops = 0;
	refusals = 0;
	exhausted = false;
	private readonly observations: string[] = [];

	/** A read that already failed was asked again: asking more won't go differently. */
	stuck = false;

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
		sentDiscussion: string,
		private readonly sessionBudget?: { limit: number; onExhausted: () => void },
		private readonly opaque = false
	) {
		this.sentDiscussion = sentDiscussion;
	}

	/** Evidence survives a CLI that cannot resume an interrupted first prompt. */
	finalEvidence(): string {
		return this.observations.join('\n\n');
	}

	private refuse(text: string): { text: string; isError: boolean } {
		this.refusals++;
		if (this.exhausted) this.sessionBudget?.onExhausted();

		return refusal(text);
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
		const wasExhausted = this.exhausted;
		const wasFinal = this.turns.isFinal();

		this.ops++;
		this.exhausted = Boolean(this.sessionBudget && this.ops >= this.sessionBudget.limit);

		if (opts.signal.aborted) return this.refuse('The review was stopped.');
		if (wasExhausted) return this.refuse(FINAL_TURN_NOTE);
		if (wasFinal) return this.refuse(FINAL_TURN_NOTE);

		const offer = { exec: Boolean(opts.exec), delegate: Boolean(opts.delegate) };
		const offered = nativeToolNames(offer);

		if (nativeToolNames({ exec: true, delegate: true }).includes(name) && !offered.includes(name))
			return this.refuse(`Tool ${name} is not available to your role. Your tools: ${offered.join(', ')}.`);

		const action = toolAction(name, args, offer);

		if (!action) return this.refuse(`There is no tool named ${name}.`);

		if (!this.opaque && this.stepCalls >= REVIEW_POLICY.maxRetrievalsPerTurn)
			return this.refuse(
				`At most ${REVIEW_POLICY.maxRetrievalsPerTurn} tool calls per step. Call this one in your next step.`
			);

		if (!this.opaque && action.action === 'run' && this.stepRuns >= REVIEW_POLICY.maxRunsPerTurn)
			return this.refuse(`At most ${REVIEW_POLICY.maxRunsPerTurn} runs per step. Run this one in your next step.`);

		const key = JSON.stringify(action);
		const read = !['run', 'writeFile', 'delegate'].includes(action.action);

		if (read && this.failedReads.has(key)) {
			this.stuck = true;
			opts.onLog?.(`${opts.label} repeated a request that failed; asking for its answer`);

			return this.refuse(`This exact request already failed. ${FINAL_TURN_NOTE}`);
		}

		if (this.stepCalls++ === 0 || this.opaque) this.retrievals++;

		if (action.action === 'run') {
			this.stepRuns++;
			this.runs++;
		}

		opts.onProgress?.('retrieval', 0, `Reading repository evidence for ${opts.label}`);

		const result = await this.execute(action);

		if (this.sessionBudget) this.observations.push(formatToolResults([result]).slice(0, 4000));

		this.runs += result.runs ?? 0;
		this.stepChars = this.opaque ? 0 : this.stepChars + result.content.length;
		if (!result.ok && read) this.failedReads.add(key);

		if (result.ok && result.path)
			opts.onLog?.(`Reading ${result.path}${result.startLine ? `:${result.startLine}` : ''}`);

		const closing = this.exhausted || this.turns.nextIsFinal() ? LAST_TOOLS_NOTE : '';

		if (this.exhausted) this.sessionBudget?.onExhausted();

		return { text: formatToolResults([result]) + (await this.discussionNote()) + closing, isError: false };
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
	private async discussionNote(): Promise<string> {
		const discussion = (await this.opts.getDiscussion?.()) ?? '';

		if (!discussion || discussion === this.sentDiscussion) return '';

		this.sentDiscussion = discussion;

		return `\n\n${DISCUSSION_NOTE}\n${discussion}`;
	}
}
