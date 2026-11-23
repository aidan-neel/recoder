import { sleep } from '../../models/llm/retry';

interface Attempt<T> {
	value: T;
	errorOutput?: string;
	partial?: boolean;
	resume?: () => void;
}

/** Short request throttles only; a spent subscription must not be replayed or retried before its reset. */
export function devinRetryDelay(output: string, retry = 0, requireHint = false): number | null {
	if (
		!/rate.?limit|too many requests|\b429\b/i.test(output) ||
		/quota|usage limit|credit|billing|not logged in|unauthenticated/i.test(output)
	)
		return null;

	let hint: number | undefined;
	const relative = /(?:reset(?:s)?|try again|retry)\s+(?:in|after)\s+([^()\n]+)/i.exec(output)?.[1];

	if (relative) {
		const parts = [
			...relative.matchAll(/(\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/gi)
		];

		if (!parts.length) return null;

		hint = parts.reduce(
			(sum, part) =>
				sum +
				Number(part[1]) *
					(/^m(?:s|illi)/i.test(part[2]) ? 1 : /^s/i.test(part[2]) ? 1000 : /^m/i.test(part[2]) ? 60_000 : 3_600_000),
			0
		);
	} else {
		const seconds = /retry[-_ ]after["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)(?=\s*[,}"'\n]|$)/i.exec(output)?.[1];
		const after = /retry[-_ ]after["']?\s*[:=]\s*["']?([^\n"'}]+)/i.exec(output)?.[1]?.trim();
		const reset = /reset(?:s)? at\s+([^\n)]+)/i.exec(output)?.[1]?.trim();
		const date = after ?? reset;

		if (date) {
			hint = seconds !== undefined ? Number(seconds) * 1000 : Date.parse(date) - Date.now();
			if (!Number.isFinite(hint)) return null;
		}
	}

	if ((requireHint && hint === undefined) || (hint !== undefined && hint > 60_000)) return null;

	return hint === undefined ? 5_000 * 2 ** retry : Math.max(1_000, hint + 1_000 + Math.random() * 1_000);
}

/** A throttle being waited out: how long until the next try, and which retry it is of how many. */
export interface DevinThrottle {
	retryInMs: number;
	attempt: number;
	attempts: number;
}

const RETRIES = 3;

/**
 * At most three retries inside the original deadline; partial work requires a session continuation callback.
 * `onThrottle` hears each wait before it starts, so a run that is only waiting does not look stuck.
 */
export async function withDevinRetries<T>(
	signal: AbortSignal,
	attempt: () => Promise<Attempt<T>>,
	onThrottle?: (throttle: DevinThrottle) => void
): Promise<T> {
	for (let retry = 0; ; retry++) {
		signal.throwIfAborted();

		const result = await attempt();
		const delay = result.errorOutput ? devinRetryDelay(result.errorOutput, retry, result.partial) : null;

		if ((result.partial && !result.resume) || delay === null) return result.value;

		if (retry >= RETRIES) {
			if (result.resume) await sleep(delay, signal);

			return result.value;
		}

		result.resume?.();
		console.warn(`[devin] Request throttled; retry ${retry + 1}/${RETRIES} in ${delay / 1000}s`);
		onThrottle?.({ retryInMs: delay, attempt: retry + 1, attempts: RETRIES });
		await sleep(delay, signal);
	}
}
