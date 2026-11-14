/** The bounds a resizable panel's width stays within, in CSS px at the base font scale. */
export interface WidthRange {
	min: number;
	max: number;
}

/** A width held inside the range and rounded to a whole px. */
export function clampWidth(width: number, { min, max }: WidthRange): number {
	return Math.round(Math.min(max, Math.max(min, width)));
}

/** The width a key asks for: arrows step, Home and End go to the ends. Null when the key is not one of them. */
export function keyWidth(key: string, width: number, range: WidthRange, step: number): number | null {
	if (key === 'ArrowRight') return clampWidth(width + step, range);
	if (key === 'ArrowLeft') return clampWidth(width - step, range);
	if (key === 'Home') return range.min;
	if (key === 'End') return range.max;

	return null;
}

/** The width after the pointer moved `deltaX` screen px; the root font scale turns screen px into base px. */
export function draggedWidth(startWidth: number, deltaX: number, scale: number, range: WidthRange): number {
	return clampWidth(startWidth + deltaX / scale, range);
}

/** The root font size over 16px, which every CSS px (compiled to rem) follows. 1 when it cannot be read. */
export function rootScale(): number {
	return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;
}
