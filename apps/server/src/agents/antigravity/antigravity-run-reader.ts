import type { TokenUsage } from '@recoder/shared';
import { LlmError } from '../../models/llm/errors';
import type { CliExit } from '../cli-stream';
import type { AgentEvent, AgentReply } from '../contract';
import { quotedLine } from '../quoted-line';
import { EVENT_QUOTED_CHARS, ReplyReader, tokenUsage, type StepUpdate } from './antigravity-output';

function addTokenUsage(total: TokenUsage | undefined, next: TokenUsage): TokenUsage {
	if (!total) return next;

	const sum = (left: number | null, right: number | null) =>
		left === null && right === null ? null : (left ?? 0) + (right ?? 0);

	const inputTokens = sum(total.inputTokens, next.inputTokens);
	const outputTokens = sum(total.outputTokens, next.outputTokens);

	return {
		inputTokens,
		outputTokens,
		totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
		cachedInputTokens: sum(total.cachedInputTokens, next.cachedInputTokens),
		cacheWriteInputTokens: null,
		reasoningOutputTokens: sum(total.reasoningOutputTokens, next.reasoningOutputTokens)
	};
}

/**
 * Reads `stream-json` lines for one prompt of an {@link AntigravityRun}: delegates protocol parsing, conversation-ID
 * validation and result settlement to {@link ReplyReader}, pairs each `agent_response` step's start and `DONE` usage,
 * flags non-protocol stdout lines as `error` events, and sums only the current prompt's step usages so resumed
 * `--conversation` turns never double-count prior turns.
 */
export class RunReader {
	private readonly reply: ReplyReader;
	private readonly startedSteps = new Set<number>();
	private readonly finishedSteps = new Set<number>();
	private promptTokens: TokenUsage | undefined;

	constructor(
		private readonly onEvent: (event: AgentEvent) => void,
		onConversation?: (id: string) => void
	) {
		this.reply = new ReplyReader({ onConversation });
	}

	readonly line = (raw: string): void => {
		const classified = this.reply.readLine(raw);

		if (classified.kind === 'non-json') {
			this.onEvent({
				type: 'error',
				message: `Antigravity printed a line that is not JSON: "${quotedLine(raw, EVENT_QUOTED_CHARS)}"`
			});

			return;
		}

		if (classified.kind === 'unknown') {
			this.onEvent({
				type: 'error',
				message: `Antigravity printed an unrecognized event: "${quotedLine(raw, EVENT_QUOTED_CHARS)}"`
			});

			return;
		}

		if (classified.kind === 'step') this.handleStep(classified.step);
	};

	/** Settles a run's opening turn, falling back to `result.usage` when no step emitted `DONE` usage. */
	finishInitialTurn(exit: CliExit): AgentReply {
		return this.settle(exit, this.promptTokens ?? this.reply.resultUsage());
	}

	/** Settles a resumed `--conversation` turn using only this prompt's step usages, ignoring cumulative `result.usage`. */
	finishResumedTurn(exit: CliExit): AgentReply {
		return this.settle(exit, this.promptTokens);
	}

	private settle(exit: CliExit, tokens: TokenUsage | undefined): AgentReply {
		try {
			return { text: this.reply.finish(undefined, exit), tokens };
		} catch (error) {
			const failure = error instanceof LlmError ? error : new LlmError(0, 'Antigravity run failed.');

			return { text: '', error: failure, tokens };
		}
	}

	private handleStep(body: StepUpdate): void {
		if (body.step_type !== 'agent_response') return;

		const stepId = `step_${body.step_index}`;
		const partId = `part_${body.step_index}`;

		if (!this.startedSteps.has(body.step_index)) {
			this.startedSteps.add(body.step_index);
			this.onEvent({ type: 'step-start', step: stepId });
		}

		if (body.thinking_delta) this.onEvent({ type: 'reasoning', delta: body.thinking_delta, partId });
		if (body.text_delta) this.onEvent({ type: 'text', delta: body.text_delta, partId });

		if (body.state === 'DONE' && body.usage && !this.finishedSteps.has(body.step_index)) {
			const stepTokens = tokenUsage(body.usage);

			this.finishedSteps.add(body.step_index);
			this.promptTokens = addTokenUsage(this.promptTokens, stepTokens);
			this.onEvent({ type: 'usage', usage: stepTokens, step: stepId });
		}
	}
}
