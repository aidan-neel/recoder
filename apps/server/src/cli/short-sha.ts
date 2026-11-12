/** How many characters of a commit SHA the command line prints, as git does. */
const SHORT_SHA_LENGTH = 7;

/** A commit SHA cut to the length a person reads. */
export function shortSha(sha: string): string {
	return sha.slice(0, SHORT_SHA_LENGTH);
}
