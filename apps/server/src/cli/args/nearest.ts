/** The most edits a mistyped name may be from the one meant. */
const MAX_EDITS = 2;

/**
 * The known name a mistyped one was probably meant to be: the nearest by edits, when it is near enough and the
 * typed name is not so short that anything is near it. Null when nothing is.
 */
export function nearestOf(typed: string, known: readonly string[]): string | null {
	const allowed = Math.min(MAX_EDITS, Math.floor(typed.length / 2));
	let nearest: string | null = null;
	let fewest = allowed + 1;

	for (const name of known) {
		const edits = editDistance(typed, name);

		if (edits < fewest) {
			nearest = name;
			fewest = edits;
		}
	}

	return nearest;
}

/** The Levenshtein distance: the single-character insertions, deletions and substitutions that turn `a` into `b`. */
function editDistance(a: string, b: string): number {
	let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

	for (let i = 1; i <= a.length; i++) {
		const current = [i];

		for (let j = 1; j <= b.length; j++) {
			const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);

			current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
		}

		previous = current;
	}

	return previous[b.length];
}
