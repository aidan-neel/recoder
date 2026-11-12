import { forgeCause, plainError, tooLargeText } from '../api/server-error';

/** Why a failed review stopped, as the page says it. */
interface FailureReason {
	/** The reason in plain words. */
	text: string;
	/** The server's own text when it was a tool's output, for a Details disclosure; null when `text` is all of it. */
	raw: string | null;
	/**
	 * The way forward: `continue` picks up where the review stopped,
	 * `connections` fixes a rejected forge token first, and `none` means
	 * continuing would stop the same way.
	 */
	next: 'continue' | 'connections' | 'none';
}

/** Marks of a tool's own output: a stream tag, an HTTP status or a link. */
const RAW = /\[std(?:err|out)\]|\bHTTP \d{3}\b|https?:\/\//i;

/** A tool's output without its stream tags, for the Details disclosure. */
function rawOutput(text: string): string {
	return text.replace(/\[std(?:err|out)\]\s*/gi, '').trim();
}

/**
 * Reads a failed review's stored reason (its summary). A known forge cause
 * (a diff over the forge's limit, a rejected token) is said in plain words,
 * with the tool's own output under Details. The server's own sentences pass
 * through. Any other tool output never shows as the reason: it says a
 * command failed, and the output goes to Details.
 */
export function failureReason(summary: string | null): FailureReason {
	const text = summary?.trim() ?? '';
	const raw = rawOutput(text);
	const cause = forgeCause(text);

	if (!text) return { text: 'The review server gave no reason.', raw: null, next: 'continue' };

	if (cause === 'too-large') return { text: tooLargeText(raw), raw, next: 'none' };
	if (cause === 'auth') return { text: plainError(raw), raw, next: 'connections' };
	if (!RAW.test(text)) return { text, raw: null, next: 'continue' };

	return { text: 'A command the review ran failed.', raw, next: 'continue' };
}
