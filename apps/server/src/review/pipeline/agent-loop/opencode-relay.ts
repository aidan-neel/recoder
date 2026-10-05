import type { TokenUsage } from '@recoder/shared';
import type { SessionHandlers } from '../../../agents/opencode/opencode-events.js';
import { trackTokenCall } from '../../../models/metrics.js';
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
 * Turns an OpenCode session's events into what a review shows and counts:
 * each model step spends one call of the budget and records its own token
 * usage, and its reasoning and narration stream to the developer.
 */
export class StepRelay<T> {
	/** Model steps started so far; a step is one model call. */
	steps = 0;

	/**
	 * Steps that ran to their end. OpenCode can report a step's start after the
	 * step's tool calls have already reached Recoder, but a step always ends
	 * before the next one calls anything, so tool limits count from this.
	 */
	finished = 0;
	lastActivityAt = Date.now();

	private readonly base: string;
	private tracking: ReturnType<typeof trackTokenCall> | null = null;
	private reasoning: Streaming | null = null;
	private message: Streaming | null = null;
	private stepMessageId: string | null = null;

	constructor(
		private readonly opts: JsonAgentOptions<T>,
		private readonly hooks: RelayHooks
	) {
		this.base = `${opts.label.slice(0, 24)}_${Math.random().toString(36).slice(2, 8)}`;
	}

	readonly handlers: SessionHandlers = {
		onActivity: () => (this.lastActivityAt = Date.now()),
		onStepStart: () => this.stepStarted(),
		onStepFinish: (usage) => this.stepFinished(usage),
		onReasoning: (delta) => this.reasoned(delta),
		onText: (delta, partId) => this.narrated(delta, partId)
	};

	/**
	 * The id the final result's message is shown under: what the model wrote
	 * in its last step is the start of that answer, so the result replaces it.
	 */
	finalMessageId(): string {
		return this.stepMessageId ?? `message_${this.base}_final`;
	}

	private stepStarted(): void {
		const { opts } = this;

		this.settle(true);
		this.steps++;
		this.stepMessageId = null;
		opts.budget.spend();
		this.tracking = trackTokenCall(opts.config.model, 'opencode');
		opts.onLog?.(`${opts.label} model turn ${this.steps}/${opts.maxTurns} (${opts.config.model})`);
		this.hooks.onStep(this.steps);
	}

	private stepFinished(usage: TokenUsage): void {
		this.tracking?.usage(usage);
		this.settle(true);
		this.finished++;
		this.hooks.onStepDone();
	}

	private reasoned(delta: string): void {
		const { opts } = this;

		this.reasoning ??= { id: `reason_${this.base}_${this.steps}`, text: '', emittedAt: 0 };

		const reasoning = this.reasoning;

		reasoning.text = (reasoning.text + delta).slice(0, 64_000);

		if (
			!reasoning.overthought &&
			(reasoning.text.length > REVIEW_POLICY.maxReasoningChars || isLooping(reasoning.text))
		) {
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

	/** Closes whatever the current step left open: its token record, reasoning and narration. */
	settle(ok: boolean): void {
		this.tracking?.finish(ok);
		this.tracking = null;

		if (this.reasoning?.text)
			this.opts.onReasoning?.({ id: this.reasoning.id, text: this.reasoning.text, status: ok ? 'done' : 'error' });

		this.reasoning = null;
		this.closeMessage(ok ? 'done' : 'error');
	}
}
