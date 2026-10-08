/** One line of a chart tooltip. */
export interface TipRow {
	label: string;
	value: string;
	color?: string;
}

/** A tooltip anchored at a point in the chart's own box. */
export interface Tip {
	x: number;
	y: number;
	title: string;
	rows: TipRow[];
	/** Opens under the point, for marks near the top edge. */
	below?: boolean;
}

/** The pointer's position inside `element`, in CSS pixels. */
export function pointerIn(element: HTMLElement, event: PointerEvent | MouseEvent): { x: number; y: number } {
	const box = element.getBoundingClientRect();

	return { x: event.clientX - box.left, y: event.clientY - box.top };
}

/** A tooltip over the middle of `target`, placed in `frame`'s box. */
export function tipOver(frame: HTMLElement, target: Element, title: string, rows: TipRow[]): Tip {
	const outer = frame.getBoundingClientRect();
	const inner = target.getBoundingClientRect();
	const y = inner.top - outer.top;

	return { x: inner.left - outer.left + inner.width / 2, y, title, rows, below: y < 70 };
}
