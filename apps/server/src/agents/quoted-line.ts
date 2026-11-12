import { redactedTail } from '../cli/target/redact';

/**
 * A line of a CLI's output as an error or a logged event may quote it: every credential in it (an authorization
 * header, a token in a URL or a parameter, a forge token) redacted first, so a cut never leaves half of one, then
 * cut to `maxChars`. A line longer than the redaction keeps is quoted from its end.
 */
export function quotedLine(line: string, maxChars: number): string {
	return redactedTail(line, []).slice(0, maxChars);
}
