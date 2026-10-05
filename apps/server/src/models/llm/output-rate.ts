import type { OutputRate } from '@recoder/shared';

/** The usual rough ratio of characters to tokens for prose and code. */
const CHARS_PER_TOKEN = 4;

/** The live estimate averages over this trailing window, so bursty deltas don't spike it. */
const WINDOW_MS = 2_000;

/** The first deltas of a reply often land in one burst; too little stream to judge a speed from. */
const MIN_LIVE_MS = 500;

/** A call that streamed for less than this (or answered in one piece) has no meaningful speed. */
const MIN_FINISH_MS = 250;

/**
 * Characters streamed after `start`. Text that lands at the start of a span
 * was produced before it, so it doesn't count toward that span's speed.
 */
function sumAfter(samples: { at: number; chars: number }[], start: number): number {
	return samples.reduce((sum, sample) => (sample.at > start ? sum + sample.chars : sum), 0);
}

function perSecond(tokens: number, ms: number): number {
	return Math.round(tokens / (ms / 1000));
}

/**
 * Measures one model call's output speed from its first streamed text, so
 * queueing and time to first token don't count against the model.
 */
export function outputRateMeter(now: () => number = Date.now) {
	let firstAt: number | undefined;
	let chars = 0;
	let firstChars = 0;
	const window: { at: number; chars: number }[] = [];

	return {
		/** Records a streamed delta and returns the live estimate, once there is enough stream to judge. */
		add(text: string): OutputRate | null {
			const at = now();

			if (firstAt === undefined) {
				firstAt = at;
				firstChars = text.length;
			}

			chars += text.length;
			window.push({ at, chars: text.length });
			while (window[0].at <= at - WINDOW_MS) window.shift();

			const span = Math.min(WINDOW_MS, at - firstAt);

			if (span < MIN_LIVE_MS) return null;

			return { tokensPerSecond: perSecond(sumAfter(window, at - span) / CHARS_PER_TOKEN, span), estimated: true };
		},

		/** The call's average speed: the provider's output tokens when it reported them, else the streamed text. */
		finish(outputTokens: number | null): OutputRate | null {
			const span = firstAt === undefined ? 0 : now() - firstAt;

			if (span < MIN_FINISH_MS) return null;

			const tokens = outputTokens ?? (chars - firstChars) / CHARS_PER_TOKEN;

			return { tokensPerSecond: perSecond(tokens, span), estimated: outputTokens === null };
		}
	};
}
