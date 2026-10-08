/** The palette has eight slots. */
const SLOTS = 8;

/** The color a series takes when it gets no slot of its own. */
export const OTHER_COLOR = 'var(--series-other)';

/** The color of the series in `slot`, in the palette's fixed order. */
export function seriesColor(slot: number): string {
	return slot < SLOTS ? `var(--series-${slot + 1})` : OTHER_COLOR;
}

/**
 * Gives each key a slot by its order in `keys`, which the caller ranks from
 * the full data, so a filter that hides some keys never repaints the rest.
 */
export function colorsFor(keys: readonly string[]): Map<string, string> {
	return new Map(keys.map((key, index) => [key, seriesColor(index)]));
}
