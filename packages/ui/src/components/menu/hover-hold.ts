/** True when the point lies inside the element's box. */
function contains(element: Element, x: number, y: number): boolean {
	const box = element.getBoundingClientRect();

	return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

/**
 * Keeps `trigger` looking hovered when a mouse press over it closes the
 * list it opened. The list's clear cover took the
 * pointer, and Chrome reads `:hover` again only about 100ms after the cover
 * goes, so without the hold the wash fades out and back in on every close.
 * The hold is `data-hover-hold`, which the see-through button variants paint
 * like a hover. It goes on the first pointer move that finds the trigger
 * really hovered or the pointer off it. A touch has no hover to keep, and
 * no move would follow to end the hold.
 */
export function holdHover(trigger: HTMLElement | null, press: PointerEvent): void {
	if (!trigger || press.pointerType !== 'mouse' || !contains(trigger, press.clientX, press.clientY)) return;

	/** Lets go once `:hover` can speak for the trigger again. */
	function release(event: PointerEvent): void {
		if (!trigger || (!trigger.matches(':hover') && contains(trigger, event.clientX, event.clientY))) return;

		trigger.removeAttribute('data-hover-hold');
		document.removeEventListener('pointermove', release, true);
	}

	trigger.setAttribute('data-hover-hold', '');
	document.addEventListener('pointermove', release, true);
}
