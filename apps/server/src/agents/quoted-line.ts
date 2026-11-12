import { redacted } from '../util/redact';

/**
 * A line of a CLI's output as an error or a logged event may quote it: every credential in it (a credential
 * header, a token in a URL, a parameter or a JSON field, a forge token, a provider key) redacted first, so a cut
 * never leaves half of one, then cut to its first `maxChars`. The start of a line is where a CLI says what went
 * wrong, and the words a failure is classified by are read from this quote.
 */
export function quotedLine(line: string, maxChars: number): string {
	return redacted(line, []).slice(0, maxChars);
}
