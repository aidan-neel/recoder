/**
 * True when two answers from the server hold the same data, so taking the
 * new one would only re-render the page. It walks both values once and stops
 * at the first difference, so comparing a large diff costs no more than
 * reading it, and never builds the JSON text of either side.
 */
export function sameData(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;

	if (Array.isArray(a)) {
		const list = b as unknown[];

		return a.length === list.length && a.every((item, index) => sameData(item, list[index]));
	}

	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left);

	return (
		keys.length === Object.keys(right).length && keys.every((key) => key in right && sameData(left[key], right[key]))
	);
}
