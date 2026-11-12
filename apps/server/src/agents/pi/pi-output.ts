import type { TokenUsage } from '@recoder/shared';
import { LlmError, UsageLimitError } from '../../models/llm/errors';
import type { CliExit } from '../cli-stream';
import { quotedLine } from '../quoted-line';

/** How to sign in: Pi has no sign-in subcommand, only `/login` inside its interactive mode. */
export const PI_LOGIN = 'pi, then type /login';

/** Longest stretch of the CLI's output quoted in an error. */
const QUOTED_CHARS = 300;

/**
 * Pi's words when the model's provider has no credential (`No API key found for anthropic.`, printed before any
 * model call), and a provider's own 401, which Pi quotes as `401 <message>`.
 */
const SIGNED_OUT =
	/no api key found|^401\b|invalid (?:x-)?api.?key|incorrect api key|authentication_error|unauthorized/i;

/**
 * A throttle in its own words, which clears within a minute. It is tested before {@link SPENT}: Gemini's per-minute
 * `429 RESOURCE_EXHAUSTED` also says "exceeded your current quota" and "billing details".
 */
const THROTTLED = /rate.?limit|too many requests|resource_exhausted|per.?minute/i;

/** A spent plan or credit balance, which lasts hours: OpenAI's `insufficient_quota`, a 402, or a usage limit. */
const SPENT = /^402\b|quota|usage limit|billing|credit balance|out of credits/i;

/** A 429 that names neither a throttle nor a spent plan, which is retried as a throttle. */
const TOO_MANY = /^429\b/;

const OVERLOADED = /^529\b|overloaded/i;

/** Pi's usage counts for one model call. `input` leaves out the cached tokens, which Pi counts on their own. */
export interface PiUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

/** A model call's usage as Recoder counts it: the input includes the cached tokens, read or written. */
export function tokenUsage({ input, output, cacheRead, cacheWrite }: PiUsage): TokenUsage {
	const inputTokens = input + cacheRead + cacheWrite;

	return {
		inputTokens,
		outputTokens: output,
		totalTokens: inputTokens + output,
		cachedInputTokens: cacheRead,
		cacheWriteInputTokens: cacheWrite,
		reasoningOutputTokens: null
	};
}

/** The usage of several model calls added up: what one call of `complete` reports. */
export function totalUsage(usages: readonly PiUsage[]): PiUsage {
	return usages.reduce(
		(sum, usage) => ({
			input: sum.input + usage.input,
			output: sum.output + usage.output,
			cacheRead: sum.cacheRead + usage.cacheRead,
			cacheWrite: sum.cacheWrite + usage.cacheWrite
		}),
		{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
	);
}

/**
 * A failed call's error from Pi's message, quoted through {@link quotedLine}: signed out is a 401 naming the sign-in,
 * a spent plan or credit a usage cap, a throttle a 429 that is retried, an overload a 529, anything else a 0.
 */
export function piError(message: string): LlmError {
	const line = quotedLine(message.trim(), QUOTED_CHARS);

	if (SIGNED_OUT.test(line)) return new LlmError(401, `Pi is not signed in to this model's provider. Run: ${PI_LOGIN}`);
	if (THROTTLED.test(line)) return new LlmError(429, line);
	if (SPENT.test(line)) return new UsageLimitError(/^402\b|credit/i.test(line) ? 402 : 429, line);
	if (TOO_MANY.test(line)) return new LlmError(429, line);

	return new LlmError(OVERLOADED.test(line) ? 529 : 0, line);
}

/**
 * The error of a run that exited non-zero, from its stderr, else its exit code. The error is the first line that is
 * neither a `Warning:` (a model id Pi did not know prints one first) nor an indented line (the docs paths Pi lists
 * after `No API key found`).
 */
export function exitError(exit: CliExit): LlmError {
	const line = exit.stderr.split('\n').find((item) => item.trim() && !/^\s/.test(item) && !/^warning\b/i.test(item));

	return piError(line ?? `Pi exited with code ${exit.code}.`);
}
