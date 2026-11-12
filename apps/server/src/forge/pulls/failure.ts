import { redactedTail } from '../../cli/target/redact.js';
import { GhError, type GhErrorKind } from '../cli.js';
import { getToken } from '../tokens.js';

/**
 * What failed, in words safe for the page. Forge output can quote a remote URL
 * with a token in it, a path or a header, so no part of it reaches a response.
 */
const FAILURE_MESSAGES: Record<GhErrorKind, string> = {
	auth: 'The forge refused the credentials. Check Settings → Connections.',
	'rate-limit': 'The forge’s rate limit was reached. Try again later.',
	unavailable: 'The forge could not be reached.',
	'not-found': 'The forge has no such repository or pull request.',
	unknown: 'The forge could not answer.'
};

/** A forge failure in words safe for the page: no forge output, path or token. */
export function forgeFailureMessage(err: unknown): string {
	if (err instanceof GhError) return FAILURE_MESSAGES[err.kind];

	return 'The repository could not be read.';
}

/** Logs a forge failure for whoever runs the server, with every credential it may quote removed. */
export function logForgeFailure(context: string, err: unknown): void {
	console.warn(`[recoder] ${context} failed:`, redactedForgeText(err instanceof Error ? err.message : String(err)));
}

/** The end of a forge's output with the stored tokens and anything shaped like a credential removed. */
export function redactedForgeText(text: string): string {
	return redactedTail(text, storedTokens());
}

function storedTokens(): string[] {
	return [getToken('github'), getToken('gitlab')].filter((token) => token !== undefined);
}
