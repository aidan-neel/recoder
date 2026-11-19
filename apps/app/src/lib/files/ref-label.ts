const FULL_SHA = /^[0-9a-f]{40}$/;

const SHORT_SHA_LENGTH = 7;

/** A commit's hash as a person reads it: its first seven characters. */
export function shortSha(sha: string): string {
	return sha.slice(0, SHORT_SHA_LENGTH);
}

/** A ref as a person reads it: a commit as its short hash, a branch as its name. */
export function refLabel(ref: string): string {
	return FULL_SHA.test(ref) ? shortSha(ref) : ref;
}
