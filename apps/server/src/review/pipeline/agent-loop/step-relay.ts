import type { ModelProvider, TokenUsage } from '@recoder/shared';
import type { AgentEvent } from '../../../agents/contract.js';
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

/** How long a prompt's last step may take to report its usage after the prompt itself has answered. */
const USAGE_GRACE_MS = 1_000;

/** One model step's record in the review's metrics, and whether its usage has arrived. */
interface StepCall {
	/** The model message the step produces, when the server names it. */
	step?: string;
	tracking: ReturnType<typeof trackTokenCall>;
	reported: boolean;
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
	lastActivityAt = Date.now();

	private readonly base: string;

	/** The provider the steps are counted under: the agent CLI that runs them. */
	private readonly provider: ModelProvider;

	/** The step in progress, the steps of this prompt, and those that ended with no usage yet. */
	private current: StepCall | null = null;
	private promptCalls: StepCall[] = [];
	private awaiting: StepCall[] = [];
	private onReported: (() => void) | null = null;
	private reasoning: Streaming | null = null;
	private message: Streaming | null = null;
	private stepMessageId: string | null = null;

	constructor(
		private readonly opts: JsonAgentOptions<T>,
		private readonly hooks: RelayHooks
	) {
		this.base = `${opts.label.slice(0, 24)}_${Math.random().toString(36).slice(2, 8)}`;
		this.provider = opts.config.provider ?? 'openai-compatible';
	}

	/** Every event is a sign of life; the ones that carry a step, usage, reasoning or text are acted on. */
	readonly onEvent = (event: AgentEvent): void => {
		this.lastActivityAt = Date.now();

		if (event.type === 'step-start') this.stepStarted(event.step);
		else if (event.type === 'usage') this.stepFinished(event.usage, event.step);
		else if (event.type === 'reasoning') this.reasoned(event.delta);
		else if (event.type === 'text') this.narrated(event.delta, event.partId);
		else if (event.type === 'error') this.opts.onLog?.(`${this.opts.label}: ${event.message}`);
	};

	/**
	 * The id the final result's message is shown under: what the model wrote
	 * in its last step is the start of that answer, so the result replaces it.
	 */
	finalMessageId(): string {
		return this.stepMessageId ?? `message_${this.base}_final`;
	}

	private stepStarted(step?: string): void {
		const { opts } = this;

		this.settle(true);
		this.steps++;
		this.stepMessageId = null;
		opts.budget.spend();
		this.current = { step, tracking: trackTokenCall(opts.config.model, this.provider), reported: false };
		this.promptCalls.push(this.current);
		opts.onLog?.(`${opts.label} model turn ${this.steps}/${opts.maxTurns} (${opts.config.model})`);
		this.hooks.onStep(this.steps);
	}

	private stepFinished(usage: TokenUsage, step?: string): void {
		this.report(this.callFor(step), usage);
		this.settle(true);
		this.finished++;
		this.hooks.onStepDone();
	}

	/** The call a finished step belongs to: the one with its message id, else, when ids are not given, the latest open one. */
	private callFor(step?: string): StepCall | undefined {
		if (!step) return this.current ?? this.awaiting[0];

		const named = [this.current, ...this.awaiting].find((call) => call?.step === step);

		return named ?? (this.current?.step ? undefined : (this.current ?? undefined));
	}

	private report(call: StepCall | undefined, usage: TokenUsage): void {
		if (!call || call.reported) return;

		call.reported = true;
		call.tracking.usage(usage);
		this.awaiting = this.awaiting.filter((item) => item !== call);
		this.onReported?.();
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

	/**
	 * Ends a prompt: settles its last step, gives the step events a moment to report usage that is still on its
	 * way, then fills in what they never did from the prompt's own total. A prompt whose events never arrived
	 * still counts as one request.
	 */
	async finishPrompt(tokens: TokenUsage | undefined, ok: boolean): Promise<void> {
		this.settle(ok);

		const calls = this.promptCalls;

		this.promptCalls = [];

		if (calls.length === 0) {
			if (!ok && !tokens) return;

			const missed = trackTokenCall(this.opts.config.model, this.provider);

			if (tokens) missed.usage(tokens);

			missed.finish(ok);

			return;
		}

		await this.untilReported(calls);

		const [only] = calls;

		if (calls.length === 1 && !only!.reported && tokens) this.report(only, tokens);

		this.awaiting = [];
	}

	/** Resolves once every call of `calls` has its usage, or after the grace period. */
	private untilReported(calls: StepCall[]): Promise<void> {
		if (calls.every((call) => call.reported)) return Promise.resolve();

		return new Promise((resolve) => {
			const done = () => {
				clearTimeout(timer);
				this.onReported = null;
				resolve();
			};

			const timer = setTimeout(done, USAGE_GRACE_MS);

			this.onReported = () => {
				if (calls.every((call) => call.reported)) done();
			};
		});
	}

	/** Closes whatever the current step left open: its token record, reasoning and narration. */
	settle(ok: boolean): void {
		if (this.current) {
			this.current.tracking.finish(ok);
			if (!this.current.reported) this.awaiting.push(this.current);
		}

		this.current = null;

		if (this.reasoning?.text)
			this.opts.onReasoning?.({ id: this.reasoning.id, text: this.reasoning.text, status: ok ? 'done' : 'error' });

		this.reasoning = null;
		this.closeMessage(ok ? 'done' : 'error');
	}
}
