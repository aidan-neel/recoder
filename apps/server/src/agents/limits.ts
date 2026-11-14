import { providerKey, type ProviderLimits, type ProviderRef } from '@recoder/shared';
import { redacted } from '../util/redact';
import { TtlCache } from '../util/ttl-cache';
import { readAntigravityLimits } from './antigravity/limits';
import { readClaudeCodeLimits } from './claude-code/limits';
import { readCodexLimits } from './codex/limits';
import { readGrokLimits } from './grok/limits';
import { LimitsError, type LimitsReading } from './limits-read';
import { OPENCODE_GO, readOpenCodeGoLimits } from './opencode/limits';

type Env = Record<string, string | undefined>;

/** How long a read is kept: Settings may ask again on every visit, and some usage endpoints rate-limit hard. */
const CACHE_MS = 60_000;

/** What a read that failed for a reason no reader foresaw says; the cause goes to the log. */
const UNEXPECTED_FAILURE = 'Its usage could not be read.';

/**
 * The providers whose limits Recoder reads, by provider key; every other key is unsupported. Cursor is not here:
 * its usage is only on cursor.com behind a session, and where `cursor-agent login` keeps that session is not
 * documented (the macOS Keychain, or a file whose path differs between reports).
 */
const READERS = new Map<string, (env: Env) => Promise<LimitsReading>>([
	['cli:claude-code', readClaudeCodeLimits],
	['cli:codex', readCodexLimits],
	['cli:grok', readGrokLimits],
	['cli:antigravity', readAntigravityLimits],
	[`opencode:${OPENCODE_GO}`, readOpenCodeGoLimits]
]);

/** Reads a provider's usage limits, one provider per call, and keeps each answer for {@link CACHE_MS}. */
export class ProviderLimitsReader {
	private readonly cache = new TtlCache<ProviderLimits>(CACHE_MS);

	constructor(private readonly env: Env = process.env) {}

	/**
	 * The provider's limits, as read within the last minute unless `refresh` asks for a new read. It never
	 * rejects: a failed read is an `error` whose reason is fit to show, and is kept like any other answer.
	 */
	read(ref: ProviderRef, refresh = false): Promise<ProviderLimits> {
		const key = providerKey(ref);
		const reader = READERS.get(key);

		if (!reader) return Promise.resolve({ status: 'unsupported' });
		if (refresh) this.cache.delete(key);

		return this.cache.get(key, () => settle(key, () => reader(this.env)));
	}
}

export const providerLimits = new ProviderLimitsReader();

/** A reader's reading as the route answers it: stamped with the time of the read, or turned into an `error`. */
async function settle(key: string, read: () => Promise<LimitsReading>): Promise<ProviderLimits> {
	try {
		const reading = await read();

		return reading.status === 'ready' ? { ...reading, checkedAt: new Date().toISOString() } : reading;
	} catch (error) {
		if (error instanceof LimitsError) return { status: 'error', reason: error.message };

		console.warn(`[limits] ${key}: ${redacted(error instanceof Error ? error.message : String(error), [])}`);

		return { status: 'error', reason: UNEXPECTED_FAILURE };
	}
}
