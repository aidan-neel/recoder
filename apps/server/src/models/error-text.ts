import { homedir } from 'node:os';
import { redactedTail } from '../cli/target/redact.js';

/** A home directory in a path, so the record never names the person who ran the review. */
const HOME_PATHS = /(?:\/home\/|\/Users\/|[A-Za-z]:\\Users\\)[^/\\\s'"]+/g;

/**
 * A failed call's provider error as a record may keep it: the last lines of
 * its message with the `secrets` the call was given, key and token shapes,
 * authorization headers and home directories removed.
 */
export function providerErrorText(err: unknown, secrets: readonly (string | undefined)[]): string {
	const message = err instanceof Error ? err.message : String(err);
	const known = secrets.filter((secret): secret is string => Boolean(secret));

	return redactedTail(withoutHome(message), known);
}

/** The running user's home, and any other home directory a path names, as `~`. */
function withoutHome(text: string): string {
	const home = homedir();
	const own = home.length > 1 ? text.split(home).join('~') : text;

	return own.replace(HOME_PATHS, '~');
}
