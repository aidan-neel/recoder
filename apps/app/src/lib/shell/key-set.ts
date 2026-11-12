/** A copy of the set with `key` in it. */
export function withKey(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
	return new Set(set).add(key);
}

/** A copy of the set without `key`. */
export function withoutKey(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
	const next = new Set(set);

	next.delete(key);

	return next;
}
