const FULL_SHA = /^[0-9a-f]{40}$/;

const SHORT_SHA_LENGTH = 7;

/** A ref as a person reads it: a commit as its first seven characters, a branch as its name. */
export function refLabel(ref: string): string {
	return FULL_SHA.test(ref) ? ref.slice(0, SHORT_SHA_LENGTH) : ref;
}
