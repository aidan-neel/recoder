/**
 * Plain code-point order for strings, the same on every machine and locale,
 * for sorts whose result is stored, hashed or compared across runs.
 */
export function byCodePoint(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
