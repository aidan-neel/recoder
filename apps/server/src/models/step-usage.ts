import type { ModelProvider, ReasoningEffort, TokenUsage, ModelCallRow } from '@recoder/shared';
import { trackTokenCall } from './metrics';

/** How long a prompt's last step may take to report its usage after the prompt itself has answered. */
const USAGE_GRACE_MS = 1_000;

/** The model an agent run's steps are billed to. */
export interface StepModel {
	model: string;
	provider?: ModelProvider;
	reasoningEffort?: ReasoningEffort;
}

/** One model step's record in the metrics, and whether its usage has arrived. */
interface StepCall {
	/** The model message the step produces, when the agent names it. */
	step?: string;
	tracking: ReturnType<typeof trackTokenCall>;
	reported: boolean;
}

/**
 * Records each model step of an agent run as one `model_calls` row: a row opens when a step starts, takes its
 * usage when the step's usage event arrives (which can come after the step ends), and a prompt whose steps
 * never arrived still counts as one call.
 */
export class StepUsage {
	private position: ({ session: string; turn: number } & Pick<ModelCallRow, 'prefix'>) | undefined;
	private current: StepCall | null = null;
	private promptCalls: StepCall[] = [];
	private awaiting: StepCall[] = [];
	private onReported: (() => void) | null = null;

	constructor(private readonly model: StepModel) {}

	/** Where the next steps sit: their agent session and the prompt's turn in it. */
	promptStarted(position: { session: string; turn: number } & Pick<ModelCallRow, 'prefix'>): void {
		this.position = {
			session: position.session,
			turn: position.turn,
			...(position.prefix && { prefix: position.prefix })
		};
	}

	stepStarted(step?: string): void {
		this.settle();
		this.current = { step, tracking: this.track(), reported: false };
		this.promptCalls.push(this.current);
	}

	stepFinished(usage: TokenUsage, step?: string): void {
		this.report(this.callFor(step), usage);
		this.settle();
	}

	/** Closes the step in progress, failed when `error` is set. An unreported step can still receive late usage. */
	settle(error?: unknown): void {
		const call = this.current;

		this.current = null;

		if (!call) return;

		if (error) call.tracking.fail(error);
		else call.tracking.complete();

		if (!call.reported) this.awaiting.push(call);
	}

	/**
	 * Settles the prompt once its steps report or the grace period ends. A prompt with no step events is one
	 * call (failed with `error` when it has one), and a single unreported step takes the prompt's total.
	 */
	async finishPrompt(tokens: TokenUsage | undefined, error?: unknown): Promise<void> {
		this.settle(error);

		const calls = this.promptCalls;

		this.promptCalls = [];

		if (calls.length === 0) {
			this.recordMissed(tokens, error);

			return;
		}

		await this.untilReported(calls);

		const [only] = calls;

		if (calls.length === 1 && only && tokens) this.report(only, tokens);

		this.awaiting = [];
	}

	private track(): ReturnType<typeof trackTokenCall> {
		const { model, provider, reasoningEffort } = this.model;

		return trackTokenCall(model, provider ?? 'openai-compatible', reasoningEffort, this.position);
	}

	private recordMissed(tokens: TokenUsage | undefined, error?: unknown): void {
		const missed = this.track();

		if (tokens) missed.usage(tokens);

		if (error) missed.fail(error);
		else missed.complete();
	}

	/** The call a finished step belongs to: the one with its message id, else, when ids are not given, the open one. */
	private callFor(step?: string): StepCall | undefined {
		if (!step) return this.current ?? this.awaiting[0];

		const named = [this.current, ...this.awaiting].find((call) => call?.step === step);

		if (named) return named;
		if (this.current?.step) return undefined;

		return this.current ?? undefined;
	}

	private report(call: StepCall | undefined, usage: TokenUsage): void {
		if (!call || call.reported) return;

		call.reported = true;
		call.tracking.usage(usage);
		this.awaiting = this.awaiting.filter((item) => item !== call);
		this.onReported?.();
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
}
