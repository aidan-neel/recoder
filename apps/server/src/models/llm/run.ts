import type { TokenUsage } from '@recoder/shared';
import { trackTokenCall } from '../metrics';
import { acquireLlmSlot, releaseLlmSlot } from './limiter';
import { requestScope, withHardDeadline, withRetries, type RequestScope } from './retry';
import { transportFor } from './transports';
import { DEFAULT_TIMEOUT_MS, type ChatOptions } from './types';

type TokenTracking = ReturnType<typeof trackTokenCall>;

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

/** The caller's options bound to this call: its scope, remaining budget and usage tracking. */
function scopedOptions(opts: ChatOptions, scope: RequestScope, tracking: TokenTracking, deadline: number): ChatOptions {
	return {
		...opts,
		signal: scope.signal,
		timeoutMs: Math.max(1, deadline - Date.now()),
		onUsage: scope.live((usage: TokenUsage) => {
			tracking.usage(usage);
			opts.onUsage?.(usage);
		}),
		onReasoning: opts.onReasoning && scope.live(opts.onReasoning)
	};
}

/**
 * Run one model call through its provider's transport: wait for a concurrency
 * slot, track token usage, retry transient failures and settle by the hard
 * deadline. With `onToken` the call streams; once text has reached the caller
 * a retry would repeat it, so a streaming call only retries before the first token.
 */
export async function runChat(opts: ChatOptions, onToken?: (text: string) => void): Promise<string> {
	const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	const progress = progressReporter(opts.onProgress);
	let acquired = false;
	let tracking: TokenTracking | undefined;
	let success = false;
	const scope = requestScope(opts.signal);

	try {
		await acquireLlmSlot(opts.signal, Math.max(1, deadline - Date.now()));
		acquired = true;
		progress.running();
		tracking = trackTokenCall(opts.model, opts.provider ?? 'openai-compatible');

		const call = scopedOptions(opts, scope, tracking, deadline);
		const transport = transportFor(opts.provider);
		let streamed = false;

		const forward =
			onToken &&
			scope.live((text: string) => {
				streamed = true;
				onToken(text);
			});

		const work = withRetries(
			call,
			deadline,
			(timeoutMs) => transport({ ...call, timeoutMs }, forward),
			() => !streamed
		);

		const result = await withHardDeadline(work, deadline, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.signal);

		success = true;

		return result;
	} finally {
		scope.end();
		progress.stop();
		if (acquired) releaseLlmSlot();
		tracking?.finish(success);
	}
}
