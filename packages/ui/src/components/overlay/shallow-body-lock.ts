import { useEffect, type RefObject } from 'react';

/** The child of <body> that holds `element`, or null when it sits elsewhere. */
function hostOf(element: Element | null | undefined): Element | null {
	return element ? ([...document.body.children].find((child) => child.contains(element)) ?? null) : null;
}

/** Body's children the mounted overlays lifted, and how many overlays share that lift. */
const lift = { holders: 0, children: new Set<HTMLElement>() };

/** Lifts body's children that carry no pointer-events of their own, and joins the lift. */
function holdLift(): void {
	for (const child of document.body.children) {
		if (child instanceof HTMLElement && !child.style.pointerEvents) {
			child.style.pointerEvents = 'auto';
			lift.children.add(child);
		}
	}

	lift.holders += 1;
}

/** Leaves the lift; the last overlay to leave drops it, so one never un-lifts the page under another. */
function releaseLift(): void {
	lift.holders -= 1;

	if (lift.holders > 0) return;

	for (const child of lift.children) child.style.removeProperty('pointer-events');

	lift.children.clear();
}

/**
 * A clear layer right before `host` and at `element`'s z-index, so it covers
 * everything the page floats as high, while the overlay, later in the order,
 * stays over it. Radix gives a popper wrapper the content's z-index only a
 * render later, so the content's is the one to read.
 */
function coverBefore(host: Element, element: HTMLElement): HTMLElement {
	const layer = document.createElement('div');

	layer.setAttribute('data-ui', 'page-cover');
	layer.setAttribute('aria-hidden', 'true');
	layer.style.cssText = 'position: fixed; inset: 0; pointer-events: auto';
	layer.style.zIndex = getComputedStyle(element).zIndex;
	host.before(layer);

	return layer;
}

interface ShallowBodyLockProps {
	/**
	 * For an overlay with no scrim (a Select): an element inside it. A clear
	 * layer then takes the scrim's place under the overlay, so a press outside
	 * lands on that layer and never on the page.
	 */
	cover?: RefObject<HTMLElement | null>;
}

/**
 * Keeps a modal overlay's pointer lock shallow. Radix sets `pointer-events:
 * none` on <body>, and every element on the page restyles to inherit it, on
 * open and on close; lifting body's children to `auto` stops that restyle at
 * them. The scrim, or the layer `cover` adds, still takes presses outside.
 * Render it inside the overlay's Radix content: its effect then runs before
 * Radix locks <body> and its cleanup after Radix frees it, so neither side
 * restyles the page. Inside another modal, <body> is already locked and it
 * does nothing.
 */
export function ShallowBodyLock({ cover }: ShallowBodyLockProps): null {
	useEffect(() => {
		const element = cover?.current;
		const host = hostOf(element);

		if (document.body.style.pointerEvents === 'none' || (cover && !host)) return;

		holdLift();

		const layer = element && host ? coverBefore(host, element) : null;

		return () => {
			layer?.remove();
			releaseLift();
		};
	}, [cover]);

	return null;
}
