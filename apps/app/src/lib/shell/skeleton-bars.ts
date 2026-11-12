/** The kit's CSS animation that keeps a skeleton invisible for `--skeleton-delay`, then fades it in. */
export const HOLD_ANIMATION = 'ui-skeleton-hold';

/** The kit's light that passes over a skeleton bar (its `::after`), every 1.4s. */
export const LIGHT_ANIMATION = 'ui-shimmer';

/**
 * Everything that runs the hold: the kit's bars, and a skeleton root marked
 * `skeleton-hold` (the queue's), which holds for its bars and dividers as one
 * piece (queue.css).
 */
export const HOLDERS = '[data-ui="skeleton"], [data-ui="skeleton-hold"]';

/** The kit's bars, each of which runs the light. */
const BARS = '[data-ui="skeleton"]';

/**
 * The `<html>` attribute that makes the holds wait 240ms instead of the
 * kit's 120ms (common.css). The boot script sets it for a full page load,
 * whose first paint comes before the page has asked for its data.
 */
export const BOOT_WAIT_ATTR = 'data-boot-wait';

/** Elements whose text never shows. The kit's scroll area puts a style in the page, under the skeletons it holds. */
const UNSHOWN = new Set(['STYLE', 'SCRIPT', 'NOSCRIPT']);

/** What the page knows of a skeleton in the canvas that has started to show. */
export interface BarSeen {
	/**
	 * When it came into view, on the page's clock: when its fade passed faint,
	 * for a bar already on screen, else when the page drew the first frame with
	 * its fade past faint, or the frame that drew it in full, or earlier when
	 * it took the place of a skeleton already in view (`handOffOnLeave`).
	 * Infinity, or a time still to come, while its fade has not shown that far.
	 */
	since: number;
	/** When its hold started, on the animations' clock, so it can resume where it was; null when unknown. */
	start: number | null;
	/**
	 * When the page first drew a frame with it past faint, which comes after
	 * `since` for a bar the compositor faded in while a long task held the
	 * page's frames back: Infinity until the page draws that frame. Absent
	 * for a bar the page showed in full at once, drawn as of `since`.
	 */
	drawn?: number;
}

declare global {
	interface Window {
		/** Skeletons whose hold has ended, so they show. The boot script fills it from the first paint on. */
		__recoderShownBars?: WeakSet<EventTarget>;
		/** When the server's skeleton holds started, on the animations' clock; the boot script sets it. */
		__recoderHoldStart?: number;
		/** The canvas's skeletons whose fade has started or that show, until they leave; the boot script fills it. */
		__recoderBarsSeen?: Map<Element, BarSeen>;
		/** When the light over each skeleton bar started, on the animations' clock; the boot script fills it. */
		__recoderBarLights?: WeakMap<Element, number>;
	}
}

/** The canvas's skeletons in view, with what is known of each; empty before the boot script has run. */
export function barsSeen(): Map<Element, BarSeen> {
	window.__recoderBarsSeen ??= new Map();

	return window.__recoderBarsSeen;
}

/**
 * Records that `holder` has been in view since `since`, or since earlier when
 * that is already known, and that its hold started at `start` when given.
 */
export function markSeen(holder: Element, since: number, start: number | null = null): void {
	const seen = barsSeen().get(holder);

	barsSeen().set(holder, {
		...seen,
		start: start ?? seen?.start ?? null,
		since: Math.min(seen?.since ?? Infinity, since)
	});
}

/** Keeps a seen bar's hold start current when the hand-off moves it. */
export function noteHoldStart(holder: Element, start: number): void {
	const seen = barsSeen().get(holder);

	if (seen) seen.start = start;
}

/**
 * Records `at` as when the light started over each bar in `holder` (itself
 * included) whose start the boot script has not caught yet. A bar shown at
 * once starts its light on the frame that first draws it, but the page hears
 * of that a frame or more later, and after a long task (the content
 * rendering) only once content has already taken the bar's place.
 */
export function guessLights(holder: Element, at: number): void {
	const lights = (window.__recoderBarLights ??= new WeakMap());

	for (const bar of [holder, ...holder.querySelectorAll(BARS)]) {
		if (bar.matches(BARS) && !lights.has(bar)) lights.set(bar, at);
	}
}

/** The earliest any skeleton in `root` (itself included) came into view, or infinity when none has. */
export function seenSince(root: Element): number {
	const seen = barsSeen();
	let since = seen.get(root)?.since ?? Infinity;

	for (const holder of root.querySelectorAll(HOLDERS)) since = Math.min(since, seen.get(holder)?.since ?? Infinity);

	return since;
}

/** True for one of the kit's skeleton holds. */
export function isHold(animation: Animation): animation is CSSAnimation {
	return animation instanceof CSSAnimation && animation.animationName === HOLD_ANIMATION;
}

/** A hold's wait and how far it has run, in ms. */
function holdClock(animation: CSSAnimation): { delay: number; current: number } {
	return {
		delay: Number(animation.effect?.getComputedTiming().delay ?? 0),
		current: Number(animation.currentTime ?? 0)
	};
}

/**
 * Where a hold that ran `current` ms of a `before` wait stands under an
 * `after` one: as far into its fade as it was, or at the start of its fade
 * when the shorter wait has already passed, or where it was.
 */
function heldAt(current: number, before: number, after: number): number {
	return current >= before ? after + (current - before) : Math.min(current, after);
}

/**
 * Takes the full load's longer wait off, so skeletons wait the kit's own
 * `--skeleton-delay` from now on. A hold already under way keeps its place:
 * a bar halfway through its fade carries on from there, and one the shorter
 * wait has already passed starts its fade now, rather than either jumping
 * ahead. Asking for the page's animations brings their styles up to date.
 */
export function endBootWait(): void {
	const root = document.documentElement;

	if (!root.hasAttribute(BOOT_WAIT_ATTR)) return;

	const holds = document.getAnimations().filter(isHold);
	const before = holds.map(holdClock);

	root.removeAttribute(BOOT_WAIT_ATTR);
	document.getAnimations();

	holds.forEach((animation, index) => {
		const { delay, current } = before[index];
		const shift = current - heldAt(current, delay, holdClock(animation).delay);

		if (shift <= 0 || animation.startTime === null) return;

		animation.startTime = Number(animation.startTime) + shift;

		if (animation.effect instanceof KeyframeEffect && animation.effect.target)
			noteHoldStart(animation.effect.target, Number(animation.startTime));
	});
}

/** True for text that does not show, or that sits in an element `skip` matches. */
function passedOver(text: Node, skip: string | undefined): boolean {
	const parent = text.parentElement;

	if (UNSHOWN.has(parent?.tagName ?? '')) return true;

	return !!skip && !!parent?.closest(skip);
}

/**
 * How many characters of shown text the elements hold, counting no further
 * once past `over`, so a check against a small skeleton never walks a whole
 * page, and leaving out the text in any element `skip` matches.
 */
export function textLength(elements: Iterable<Element>, over = Infinity, skip?: string): number {
	let length = 0;

	for (const element of elements) {
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);

		for (let text = walker.nextNode(); text; text = walker.nextNode()) {
			if (passedOver(text, skip)) continue;

			length += text.nodeValue?.trim().length ?? 0;

			if (length > over) return length;
		}
	}

	return length;
}
