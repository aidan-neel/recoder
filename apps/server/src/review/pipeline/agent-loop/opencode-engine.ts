import type { AgentReply, AgentSession } from '../../../agents/opencode/opencode-agent-session.js';
import { opencode, type OpenCodeAgent } from '../../../agents/opencode/opencode.js';
import { nativeToolNames } from '../../../evidence/native-tools.js';
import { extractJsonValue } from '../../../models/json-extract.js';
import { isRateLimitError, isTransientLlmError } from '../../../models/llm/errors.js';
import {
	acquireLlmSlot,
	llmEndpoint,
	recordLlmRateLimit,
	recordLlmSuccess,
	releaseLlmSlot
} from '../../../models/llm/limiter.js';
import { sleep } from '../../../models/llm/retry.js';
import { isAuthFailure, isUsageLimit, modelFailure } from '../../../models/model-failure.js';
import { currentReviewControl, reviewNow, reviewPausePoint } from '../../session/review-control.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import { CHAT_STYLE, NATIVE_REPLY_RULES, forNativeTools } from '../prompts.js';
import { ModelBlockedError, ReviewAbortedError, throwIfAborted } from './budget.js';
import { agentDeadlines, deadlineError, newAgentId, toolTurns, type AgentLimits } from './limits.js';
import { StepRelay } from './opencode-relay.js';
import { FINAL_TURN_NOTE, ToolGate } from './opencode-tool-gate.js';
import type { JsonAgentOptions } from './options.js';

type AgentResult<T> = { value: T | null; error?: string };

/** Why Recoder stopped a run that OpenCode was still driving. */
type Interrupt = 'paused' | 'deadline' | 'budget' | 'final' | 'runaway' | 'overthought' | 'stalled';

const BUDGET_EXHAUSTED = 'model-call budget exhausted';

const RESUME = 'Continue from where you stopped.';

const OVERTHOUGHT =
	'You spent too long thinking without acting. Stop deliberating: call a tool for the evidence you need, or give your final result with what you already know.';

const DISCUSSION_NOTE = 'Developer conversations since the review started (consider these with the review evidence):';

/** How often a run is checked for its deadline and for a model that went quiet. */
const WATCH_MS = 5_000;

/** Steps a model may take to answer once its tools are off: the answer, and one retry of it. */
const ANSWER_STEPS = 2;

/** How long to wait before resuming after a provider's transient failure, per attempt so far. */
const RESUME_BACKOFF_MS = 5_000;

/**
 * One agent run with OpenCode as the agent. OpenCode drives the model step
 * after step and calls Recoder's tools itself; Recoder keeps what it must
 * own: the tools (through {@link ToolGate}), the turn and call budget, the
 * deadline, pausing, and checking the final result.
 */
class OpenCodeRun<T> {
	private readonly limits: AgentLimits;
	private readonly relay: StepRelay<T>;
	private readonly gate: ToolGate<T>;
	private readonly spendOpts: { consumeReserve?: boolean };
	private readonly endpoint: string;
	private session: AgentSession | null = null;
	private interrupt: Interrupt | null = null;
	private toolsOn: boolean;
	private repaired = 0;

	/** Steps taken before the current prompt, and whether that prompt left the tools on. */
	private stepsBefore = 0;
	private promptTools = false;
	private readonly nudged = new Set<string>();

	constructor(
		private readonly opts: JsonAgentOptions<T>,
		private readonly agent: OpenCodeAgent,
		limits: AgentLimits
	) {
		this.limits = limits;
		this.endpoint = llmEndpoint(opts.config);
		this.spendOpts = { consumeReserve: opts.consumeReserve };
		this.toolsOn = toolTurns(opts) > 0;

		this.relay = new StepRelay(opts, {
			onStep: (step) => this.stepStarted(step),
			onStepDone: () => this.stepDone(),
			onOverthought: () => this.stop('overthought')
		});

		this.gate = new ToolGate(
			opts,
			opts.agentId ?? newAgentId(),
			{ isFinal: () => this.finalTurn(), nextIsFinal: () => this.relay.finished + 1 >= toolTurns(opts) },
			opts.getDiscussion?.() ?? ''
		);
	}

	/** The model may no longer call tools: its turns, the call budget or its time are used up. */
	private finalTurn(): boolean {
		return (
			!this.toolsOn ||
			this.gate.stuck ||
			this.relay.finished >= toolTurns(this.opts) ||
			!this.opts.budget.canSpend(1, this.spendOpts) ||
			reviewNow() >= this.limits.finalTurnAt
		);
	}

	/** Stops the run OpenCode is driving; the prompt then settles and the loop acts on the first reason given. */
	private stop(why: Interrupt): void {
		this.interrupt ??= why;
		void this.session?.abort();
	}

	/**
	 * Steps Recoder will not pay for or wait on are stopped as they start: one
	 * the budget cannot cover, one past both the agent's turns and the answer
	 * steps after its last tool turn (it is then asked for its answer with the
	 * tools off), and one from a model that was only asked to answer and keeps
	 * going instead.
	 */
	private stepStarted(step: number): void {
		const { opts } = this;

		opts.onProgress?.('running', 0, `Running ${opts.label}`);

		if (!opts.budget.canSpend(0, this.spendOpts)) this.stop('budget');
		else if (!this.promptTools && step - this.stepsBefore > ANSWER_STEPS) this.stop('runaway');
		else if (this.promptTools && step > Math.max(opts.maxTurns, toolTurns(opts) + ANSWER_STEPS)) this.stop('final');
	}

	/** A finished step reached the provider, which is what lets a backed-off model limit recover. */
	private stepDone(): void {
		this.gate.stepDone();
		recordLlmSuccess(this.endpoint);
	}

	/** Checks the deadline and whether the model has gone quiet; a sandbox run in progress is not quiet. */
	private watch(): void {
		if (reviewNow() >= this.limits.deadlineAt) return this.stop('deadline');

		const quietMs = Date.now() - this.relay.lastActivityAt;

		if (this.gate.inFlight === 0 && quietMs > REVIEW_POLICY.perCallDeadlineMs) this.stop('stalled');
	}

	private async open(): Promise<AgentSession> {
		const { opts } = this;

		return this.agent.openAgent({
			model: opts.config.model,
			reasoningEffort: opts.config.reasoningEffort,
			system: forNativeTools(opts.system) + NATIVE_REPLY_RULES + CHAT_STYLE,
			tools: this.toolsOn ? nativeToolNames(Boolean(opts.exec)) : [],
			runTool: this.gate.run,
			handlers: this.relay.handlers,
			signal: opts.signal
		});
	}

	/** One prompt to the session, watched for the deadline, a stall and a pause while OpenCode runs it. */
	private async ask(text: string): Promise<{ reply: AgentReply; why: Interrupt | null; final: boolean }> {
		const final = this.finalTurn();
		const pauseSignal = currentReviewControl()?.pauseSignal;
		const onPause = () => this.stop('paused');
		const watcher = setInterval(() => this.watch(), WATCH_MS);

		this.interrupt = null;
		this.stepsBefore = this.relay.steps;
		this.promptTools = !final;
		this.relay.lastActivityAt = Date.now();
		pauseSignal?.addEventListener('abort', onPause, { once: true });

		try {
			const reply = await this.session!.prompt(final && this.toolsOn ? `${text}\n\n${FINAL_TURN_NOTE}` : text, {
				tools: !final,
				schema: this.opts.responseSchema?.(true).schema,
				timeoutMs: Math.max(1, this.limits.deadlineAt - reviewNow())
			});

			this.relay.settle(!reply.error);

			return { reply, why: this.interrupt, final: final || this.finalTurn() };
		} finally {
			clearInterval(watcher);
			pauseSignal?.removeEventListener('abort', onPause);
		}
	}

	private canRepair(): boolean {
		return this.repaired++ < REVIEW_POLICY.schemaRepairAttempts;
	}

	/**
	 * What follows a run Recoder stopped: the next prompt to send, or the
	 * result to end on. A paused run waits here until the review resumes.
	 */
	private async afterInterrupt(why: Interrupt): Promise<{ next: string } | AgentResult<T>> {
		if (why === 'paused') {
			await reviewPausePoint(this.opts.signal);
			throwIfAborted(this.opts.signal);

			return { next: RESUME };
		}

		if (why === 'deadline') return { value: null, error: deadlineError(this.opts, this.limits) };
		if (why === 'budget') return { value: null, error: BUDGET_EXHAUSTED };
		if (why === 'runaway') return { value: null, error: 'the model kept working without giving its answer' };

		if (why === 'final') {
			this.toolsOn = false;

			return { next: FINAL_TURN_NOTE };
		}

		if (!this.canRepair())
			return {
				value: null,
				error: why === 'stalled' ? 'the model stopped responding' : 'reasoning ran too long without an answer'
			};

		return { next: why === 'stalled' ? RESUME : OVERTHOUGHT };
	}

	/**
	 * What follows a run the provider failed: resume the same session after a
	 * transient failure, or stop. Throws when the whole review must stop,
	 * because the model is blocked.
	 */
	private async afterFailure(err: NonNullable<AgentReply['error']>): Promise<{ next: string } | AgentResult<T>> {
		const { opts } = this;

		if (isAuthFailure(err) || isUsageLimit(err, opts.config))
			throw new ModelBlockedError(modelFailure(err, opts.config, 'The model rejected the request.'));

		if (isRateLimitError(err, 'opencode')) recordLlmRateLimit(this.endpoint);

		if (isTransientLlmError(err, 'opencode') && this.canRepair()) {
			opts.onLog?.(`${opts.label} hit a provider error; resuming: ${err.message}`);
			await sleep(RESUME_BACKOFF_MS * this.repaired, opts.signal).catch(() => {});
			throwIfAborted(opts.signal);

			return { next: RESUME };
		}

		opts.onLog?.(`${opts.label} failed: ${err.message}`);

		return { value: null, error: err.message };
	}

	/**
	 * Checks the model's final answer: the value when it is valid and not
	 * premature, else the prompt that sends it back to work or to fix its shape.
	 */
	private afterAnswer(reply: AgentReply, final: boolean): { next: string } | AgentResult<T> {
		const { opts } = this;
		let parsed: unknown;

		try {
			parsed = reply.structured ?? extractJsonValue(reply.text);
		} catch (err) {
			const problem = err instanceof Error ? err.message : 'invalid JSON';

			return this.canRepair()
				? { next: `Your final result was not valid JSON (${problem}). Send it again as one JSON object.` }
				: { value: null, error: problem };
		}

		if (parsed && typeof parsed === 'object' && 'message' in parsed && typeof parsed.message === 'string')
			opts.onMessage?.({ id: this.relay.finalMessageId(), text: parsed.message, status: 'done' });

		const value = opts.parse(parsed);

		if (value) {
			/** Each push-back goes out once, and only while the agent can still act on it. */
			const nudge = final ? null : opts.checkFinal?.(value, { retrievals: this.gate.retrievals, runs: this.gate.runs });

			if (!nudge || this.nudged.has(nudge)) return { value };

			this.nudged.add(nudge);
			opts.onLog?.(`${opts.label} finished early; asking it to investigate first`);

			return { next: forNativeTools(nudge) };
		}

		const problems = opts.validationError?.(parsed) ?? 'output did not match the required schema';

		if (this.canRepair()) {
			return {
				next: `Your final result did not match the required shape. Problems: ${problems}. Send the corrected final result.`
			};
		}

		const kept = opts.salvage?.(parsed);

		return kept ? { value: kept } : { value: null, error: problems };
	}

	/**
	 * Before every prompt: wait out a pause, and stop when the review is over,
	 * out of time, or out of model calls. Returns the result to end on, if any.
	 */
	private async beforePrompt(): Promise<AgentResult<T> | null> {
		const { opts } = this;

		throwIfAborted(opts.signal);
		await reviewPausePoint(opts.signal);
		throwIfAborted(opts.signal);

		if (reviewNow() >= this.limits.deadlineAt) return { value: null, error: deadlineError(opts, this.limits) };
		if (!opts.budget.canSpend(1, this.spendOpts)) return { value: null, error: BUDGET_EXHAUSTED };

		return null;
	}

	async toAnswer(): Promise<AgentResult<T>> {
		const { opts } = this;
		const discussion = opts.getDiscussion?.() ?? '';
		let text = discussion ? `${opts.user}\n\n${DISCUSSION_NOTE}\n${discussion}` : opts.user;

		this.session = await this.open();

		for (;;) {
			const blocked = await this.beforePrompt();

			if (blocked) return blocked;

			const { reply, why, final } = await this.ask(text);

			throwIfAborted(opts.signal);

			const step = why
				? await this.afterInterrupt(why)
				: reply.error
					? await this.afterFailure(reply.error)
					: this.afterAnswer(reply, final);

			if (!('next' in step)) return step;

			text = step.next;
		}
	}

	async close(): Promise<void> {
		this.relay.settle(false);
		await this.session?.close();
	}
}

/**
 * Run an agent with OpenCode as the agent itself, holding one model slot for
 * the whole run: its steps are sequential, so a run is one call at a time.
 */
export async function runOpenCodeAgent<T>(
	opts: JsonAgentOptions<T>,
	agent: OpenCodeAgent = opencode
): Promise<AgentResult<T>> {
	const limits = agentDeadlines(opts);
	const endpoint = llmEndpoint(opts.config);

	opts.onProgress?.('queued', 0, 'Waiting for a model slot');

	try {
		await acquireLlmSlot(endpoint, opts.signal, Math.max(1, limits.deadlineAt - reviewNow()));
	} catch (err) {
		throwIfAborted(opts.signal);

		return { value: null, error: err instanceof Error ? err.message : 'no model slot' };
	}

	const run = new OpenCodeRun(opts, agent, limits);

	try {
		return await run.toAnswer();
	} catch (err) {
		if (opts.signal.aborted) throw new ReviewAbortedError('review aborted');

		throw err;
	} finally {
		await run.close();
		releaseLlmSlot(endpoint);
	}
}
