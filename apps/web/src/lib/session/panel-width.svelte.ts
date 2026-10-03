/** A panel width in rem, clamped to its range and remembered per browser. Rem keeps it scaling with the root font. */
export class PanelWidth {
	value = $state(0);

	constructor(
		private readonly key: string,
		readonly min: number,
		readonly max: number,
		readonly initial: number
	) {
		this.value = initial;
	}

	/** Restores the stored width; an unavailable or out-of-range value keeps the default. */
	load(): void {
		try {
			const stored = Number(localStorage.getItem(this.key));

			if (stored >= this.min && stored <= this.max) this.value = stored;
		} catch {
			return;
		}
	}

	/** Clamps and applies the width; storage failures only skip persisting it for later visits. */
	set(rem: number): void {
		this.value = Math.min(this.max, Math.max(this.min, rem));

		try {
			localStorage.setItem(this.key, String(this.value));
		} catch {
			return;
		}
	}
}

/** The root font size in px, which turns pointer distances into rem. */
export function rootFontPx(): number {
	return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

/**
 * Captures the pointer on the pressed resize handle and reports each move until it is released.
 * While dragging, `data-resizing` on the root lets styles follow the drag.
 */
export function trackPointerDrag(event: PointerEvent, onMove: (event: PointerEvent) => void): void {
	const handle = event.currentTarget as HTMLElement;

	handle.setPointerCapture(event.pointerId);
	document.documentElement.dataset.resizing = '';

	const end = () => {
		handle.removeEventListener('pointermove', onMove);
		handle.removeEventListener('pointerup', end);
		handle.removeEventListener('pointercancel', end);
		delete document.documentElement.dataset.resizing;
	};

	handle.addEventListener('pointermove', onMove);
	handle.addEventListener('pointerup', end);
	handle.addEventListener('pointercancel', end);
}
