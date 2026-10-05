import type { TokenUsage } from '@recoder/shared';
import { trackTokenCall } from '../metrics';
import { isRateLimitError } from './errors';
import { acquireLlmSlot, llmEndpoint, recordLlmRateLimit, recordLlmSuccess, releaseLlmSlot } from './limiter';
import { outputRateMeter } from './output-rate';
import { requestScope, withHardDeadline, withRetries, type RequestScope } from './retry';
import { transportFor } from './transports';
import { DEFAULT_TIMEOUT_MS, type ChatOptions } from './types';

type TokenTracking = ReturnType<typeof trackTokenCall>;

type RateReporter = ReturnType<typeof rateReporter>;

/** Reports `queued`, then `running` once a slot is held, with a 5s heartbeat between. */
function progressReporter(onProgress: ChatOptions['onProgress']) {
	let state: 'queued' | 'running' = 'queued';
	let started = Date.now();
	const report = () => onProgress?.(state, Date.now() - started);

	report();

	const heartbeat = setInterval(report, 5000);

	return {
		running: () => {
			state = 'running';
			started = Date.now();
			report();
		},
		stop: () => clearInterval(heartbeat)
	};
}

/** Reports a call's output speed as its text streams, then its average from the provider's count once it ends. */
function rateReporter(onRate: ChatOptions['onRate']) {
	const meter = outputRateMeter();
	let outputTokens: number | null = null;

	const report = (rate: ReturnType<typeof meter.add>) => {
		if (rate) onRate?.(rate);
	};

	return {
		text: (text: string) => report(meter.add(text)),
		usage: (usage: TokenUsage) => {
			outputTokens = usage.outputTokens;
		},
		finish: () => report(meter.finish(outputTokens))
	};
}

/** The caller's options bound to this call: its scope, remaining budget, usage tracking and speed. */
function scopedOptions(
	opts: ChatOptions,
	scope: RequestScope,
	tracking: TokenTracking,
	rate: RateReporter,
	deadline: number
): ChatOptions {
	const onReasoning = opts.onReasoning;

	return {
		...opts,
		signal: scope.signal,
		timeoutMs: Math.max(1, deadline - Date.now()),
		onUsage: scope.live((usage: TokenUsage) => {
			tracking.usage(usage);
			rate.usage(usage);
			opts.onUsage?.(usage);
		}),
		onReasoning:
			onReasoning &&
			scope.live((text: string) => {
				rate.text(text);
				onReasoning(text);
			})
	};
}

/**
 * Run one model call through its provider's transport: wait for a concurrency
 * slot, track token usage, retry transient failures and settle by the hard
 * deadline. With `onToken` the call streams; once text has reached the caller
 * a retry would repeat it, so a streaming call only retries before the first token.
 * The budget starts once a slot is held, so a call queued behind others still
 * gets its full `timeoutMs`; `settleBy` caps the wait and the call together.
 */
export async function runChat(opts: ChatOptions, onToken?: (text: string) => void): Promise<string> {
	const budget = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const settleBy = opts.settleBy ?? Infinity;
	const progress = progressReporter(opts.onProgress);
	const endpoint = llmEndpoint(opts);
	let acquired = false;
	let tracking: TokenTracking | undefined;
	let success = false;
	const scope = requestScope(opts.signal);

	try {
		await acquireLlmSlot(endpoint, opts.signal, Math.max(1, Math.min(budget, settleBy - Date.now())));
		acquired = true;

		const deadline = Math.min(Date.now() + budget, settleBy);

		progress.running();
		tracking = trackTokenCall(opts.model, opts.provider ?? 'openai-compatible');

		const rate = rateReporter(opts.onRate);
		const call = scopedOptions(opts, scope, tracking, rate, deadline);
		const transport = transportFor(opts.provider);
		let streamed = false;

		const forward =
			onToken &&
			scope.live((text: string) => {
				streamed = true;
				rate.text(text);
				onToken(text);
			});

		const work = withRetries(
			call,
			deadline,
			(timeoutMs) => transport({ ...call, timeoutMs }, forward),
			() => !streamed
		);

		const result = await withHardDeadline(work, deadline, Math.max(1, deadline - Date.now()), opts.signal);

		success = true;
		recordLlmSuccess(endpoint);
		rate.finish();

		return result;
	} catch (err) {
		if (acquired && isRateLimitError(err, opts.provider)) recordLlmRateLimit(endpoint);

		throw err;
	} finally {
		scope.end();
		progress.stop();
		if (acquired) releaseLlmSlot(endpoint);
		tracking?.finish(success);
	}
}
