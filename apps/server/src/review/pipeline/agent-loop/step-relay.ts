import type { TokenUsage, VerifierSessionUsage } from '@recoder/shared';
import type { AgentEvent } from '../../../agents/contract.js';
import { StepUsage } from '../../../models/step-usage.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import type { JsonAgentOptions } from './options.js';
import { isLooping } from './stream-turn.js';

/** Reasoning and replies stream token by token and every emit carries the whole text, so emits are spaced out. */
const EMIT_MS = 300;

/** Text that is streaming to the developer: what has arrived, and when it was last shown. */
interface Streaming {
	id: string;
	text: string;
	emittedAt: number;
	/** Reasoning only: already reported as running too long. */
	overthought?: boolean;
}

/** A model without the structured-output tool writes its final JSON as text; that is the result, not narration. */
function isJsonAnswer(text: string): boolean {
	return /^\s*(\{|```)/.test(text);
}

/** What the run does when a step starts or ends, and when the model reasons without getting anywhere. */
interface RelayHooks {
	onStep: (step: number) => void;
	onStepDone: () => void;
	onOverthought: () => void;
}

/**
 * Turns an agent run's events into what a review shows and counts:
 * each model step spends one call of the budget and records its own token
 * usage, and its reasoning and narration stream to the developer.
 */
export class StepRelay<T> {
	/** Model steps started so far; a step is one model call. */
	steps = 0;

	/**
	 * Steps that ran to their end. A CLI can report a step's start after the
	 * step's tool calls have already reached Recoder, but a step always ends
	 * before the next one calls anything, so tool limits count from this.
	 */
	finished = 0;
	internalTurns: number | null = null;

	private readonly base: string;
	private readonly usage: StepUsage;
	private reasoning: Streaming | null = null;
	private message: Streaming | null = null;
	private stepMessageId: string | null = null;
	private throttled = false;

	constructor(
		private readonly opts: JsonAgentOptions<T>,
		private readonly hooks: RelayHooks
	) {
		this.base = `${opts.label.slice(0, 24)}_${Math.random().toString(36).slice(2, 8)}`;
		this.usage = new StepUsage(opts.config);
	}

	/** Acts on the events that carry a step, usage, reasoning, text or an error; tool events are the gate's. */
	readonly onEvent = (event: AgentEvent): void => {
		if (event.type === 'prompt-start') this.usage.promptStarted(event);
		else if (event.type === 'internal-turns') this.internalTurns = event.total;
		else if (event.type === 'throttled') this.waitedOut(event);
		else if (event.type === 'step-start') this.stepStarted(event.step);
		else if (event.type === 'usage') this.stepFinished(event.usage, event.step);
		else if (event.type === 'reasoning') this.reasoned(event.delta);
		else if (event.type === 'text') this.narrated(event.delta, event.partId);
		else if (event.type === 'error') this.opts.onLog?.(`${this.opts.label}: ${event.message}`);
	};

	/** Session totals live on the most recent usage row, including a failed or cancelled one. */
	verifierSession(value: VerifierSessionUsage): void {
		this.usage.verifierSession(value);
	}

	/**
	 * The id the final result's message is shown under: what the model wrote
	 * in its last step is the start of that answer, so the result replaces it.
	 */
	finalMessageId(): string {
		return this.stepMessageId ?? `message_${this.base}_final`;
	}

	/** A throttle shows as the run's progress until the next step starts, so a run that waits does not look stuck. */
	private waitedOut(event: Extract<AgentEvent, { type: 'throttled' }>): void {
		const seconds = Math.ceil(event.retryInMs / 1000);

		this.throttled = true;

		this.opts.onProgress?.(
			'throttled',
			0,
			`Rate-limited, retrying in ${seconds}s (attempt ${event.attempt} of ${event.attempts})`
		);
	}

	private stepStarted(step?: string): void {
		const { opts } = this;

		if (this.throttled) {
			this.throttled = false;
			opts.onProgress?.('running', 0, `Running ${opts.label}`);
		}

		this.settle();
		this.steps++;
		this.stepMessageId = null;
		opts.budget.spend();

		this.usage.stepStarted(step);
		opts.onLog?.(`${opts.label} model turn ${this.steps}/${opts.maxTurns} (${opts.config.model})`);
		this.hooks.onStep(this.steps);
	}

	private stepFinished(usage: TokenUsage, step?: string): void {
		this.usage.stepFinished(usage, step);
		this.settle();
		this.finished++;
		this.hooks.onStepDone();
	}

	private reasoned(delta: string): void {
		const { opts } = this;

		this.reasoning ??= { id: `reason_${this.base}_${this.steps}`, text: '', emittedAt: 0 };

		const reasoning = this.reasoning;

		const cap = opts.maxReasoningChars ?? REVIEW_POLICY.maxReasoningChars;

		reasoning.text = (reasoning.text + delta).slice(0, 2 * cap);

		if (!reasoning.overthought && (reasoning.text.length > cap || isLooping(reasoning.text))) {
			reasoning.overthought = true;
			opts.onLog?.(`${opts.label} reasoning ran long; asking for an answer`);
			this.hooks.onOverthought();
		}

		if (Date.now() - reasoning.emittedAt > EMIT_MS) {
			reasoning.emittedAt = Date.now();
			opts.onReasoning?.({ id: reasoning.id, text: reasoning.text, status: 'streaming' });
		}
	}

	private narrated(delta: string, partId: string): void {
		const id = `message_${this.base}_${partId}`;

		if (this.message && this.message.id !== id) this.closeMessage('done');

		this.message ??= { id, text: '', emittedAt: 0 };
		this.message.text += delta;
		this.stepMessageId = id;

		if (isJsonAnswer(this.message.text)) return;

		if (Date.now() - this.message.emittedAt > EMIT_MS) {
			this.message.emittedAt = Date.now();
			this.opts.onMessage?.({ id, text: this.message.text, status: 'streaming' });
		}
	}

	private closeMessage(status: 'done' | 'error'): void {
		if (this.message?.text.trim() && !isJsonAnswer(this.message.text))
			this.opts.onMessage?.({ id: this.message.id, text: this.message.text, status });

		this.message = null;
	}

	/**
	 * Ends a prompt, failed when it has an `error`: settles its last step, gives the step events a moment to
	 * report usage that is still on its way, then fills in what they never did from the prompt's own total. A
	 * prompt whose events never arrived still counts as one request, and one that failed before its first step
	 * started (a spent plan, a rejected key) as one failed request with the provider's error.
	 */
	async finishPrompt(tokens: TokenUsage | undefined, error?: unknown): Promise<void> {
		this.settle(error);
		await this.usage.finishPrompt(tokens, error);
	}

	/** Closes whatever the current step left open, failed with `error` when it has one: its token record, reasoning and narration. */
	settle(error?: unknown): void {
		const status = error ? 'error' : 'done';

		this.usage.settle(error);

		if (this.reasoning?.text) this.opts.onReasoning?.({ id: this.reasoning.id, text: this.reasoning.text, status });

		this.reasoning = null;
		this.closeMessage(status);
	}
}
