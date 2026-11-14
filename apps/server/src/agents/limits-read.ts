import type { UsageWindow } from '@recoder/shared';
import type { z } from 'zod';

/** How long one usage read may wait on the network. */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * How long a usage read that asks the provider's CLI may take in all: the CLI starting up, then its own network
 * call, which it bounds itself.
 */
export const CLI_LIMITS_TIMEOUT_MS = 20_000;

/**
 * What one provider's reader found. The dispatcher stamps a `ready` reading with the time of the read; a failed
 * read is a thrown {@link LimitsError}.
 */
export type LimitsReading =
	| { status: 'ready'; plan: string | null; windows: UsageWindow[] }
	| { status: 'signed-out' }
	| { status: 'unsupported' };

/**
 * A usage read that failed. Its message is shown to the person as is: it names the provider and what went wrong,
 * and never quotes a credential.
 */
export class LimitsError extends Error {}

/** One window, its share clamped to 0-100 and rounded to a tenth, since providers report float noise. */
export function usageWindow(label: string, usedPercent: number, resetsAt: string | null): UsageWindow {
	const clamped = Math.min(100, Math.max(0, usedPercent));

	return { label, usedPercent: Math.round(clamped * 10) / 10, resetsAt };
}

/** The word with its first letter upper-cased, as plans and windows are named in Settings (`plus` → `Plus`). */
export function capitalized(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1);
}

/** A provider's time (ISO with any precision and offset) as UTC ISO; null when it is missing or not a time. */
export function isoTime(value: string | null | undefined): string | null {
	if (!value) return null;

	const time = new Date(value);

	return Number.isNaN(time.getTime()) ? null : time.toISOString();
}

/** Unix seconds as UTC ISO; null when missing. */
export function isoFromSeconds(seconds: number | null | undefined): string | null {
	return seconds ? new Date(seconds * 1000).toISOString() : null;
}

/** `raw` read by `schema`, or a {@link LimitsError} saying the provider answered in a shape Recoder does not know. */
export function parseUsage<T>(schema: z.ZodType<T>, raw: unknown, provider: string): T {
	const parsed = schema.safeParse(raw);

	if (!parsed.success) throw new LimitsError(`${provider} reported its usage in a form Recoder could not read.`);

	return parsed.data;
}

/**
 * GETs a provider's usage endpoint and answers with its JSON body. Every failure is a {@link LimitsError} that
 * names the provider and the status, never the request's headers: a refused credential, a rate limit, another
 * status, no answer within {@link FETCH_TIMEOUT_MS}, or a body that is not JSON.
 */
export async function fetchUsage(url: string, headers: Record<string, string>, provider: string): Promise<unknown> {
	const response = await fetch(url, {
		headers: { Accept: 'application/json', ...headers },
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
	}).catch((error: unknown) => {
		throw new LimitsError(`${provider}’s usage could not be read: ${unreachable(error)}.`);
	});

	if (response.status === 401 || response.status === 403) {
		throw new LimitsError(`${provider} did not accept its sign-in (${response.status}). Sign in again.`);
	}

	if (response.status === 429) {
		throw new LimitsError(`${provider} is limiting how often its usage is read. Try again in a few minutes.`);
	}

	if (!response.ok) throw new LimitsError(`${provider}’s usage could not be read: ${response.status}.`);

	return response.json().catch(() => {
		throw new LimitsError(`${provider} reported its usage in a form Recoder could not read.`);
	});
}

/** Why a request got no answer, in words: it timed out, or it never reached the provider. */
function unreachable(error: unknown): string {
	return error instanceof DOMException && error.name === 'TimeoutError' ? 'no answer in time' : 'no connection';
}
