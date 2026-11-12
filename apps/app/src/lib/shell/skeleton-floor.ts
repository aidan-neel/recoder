import { type BarSeen, barsSeen, endBootWait, HOLD_ANIMATION, HOLDERS, markSeen, textLength } from './skeleton-bars';

/**
 * How long a skeleton that has come into view (once it can be read, see
 * `BarSeen`) stays before content may take its place, counted from the
 * first frame the page drew it. A shorter look reads as a blink. It is 245ms
 * on screen and 5ms over, since the page reads that frame's time partway
 * through the frame.
 */
const MIN_SHOWN_MS = 250;

/**
 * The attribute on content that waits for a skeleton: `waiting` while it is
 * kept unseen and out of flow, then `shown` for a frame, which keeps its own
 * transitions off while it comes back, so it lands with no fade (common.css).
 */
const WAITING_ATTR = 'data-skeleton-floor';

/** Content kept unseen while a skeleton put back shows. */
const WAITING = `[${WAITING_ATTR}="waiting"]`;

/** The shell's stand-in for a page on its way, around that page's own skeleton (`page-skeleton.tsx`). */
const PAGE_SKELETON = '[data-ui="page-skeleton"]';

/** The attribute on a waiting content's parent when the parent needs positioning to hold the content's box. */
const HOST_ATTR = 'data-skeleton-floor-host';

/** The parent's padding, which waiting content takes as its inset, so it lays out at the width it will have. */
const INSET_PROPERTY = '--skeleton-floor-inset';

/** Skeletons put back after content replaced them too soon, and the content waiting on them. */
interface Hold {
	/** The skeleton roots put back, each where it stood. */
	skeletons: Element[];
	/** The content that took their place, kept unseen meanwhile. */
	content: Element[];
	/** The parents the content waits in. */
	parents: HTMLElement[];
	/** When the content may show, on the page's clock. */
	until: number;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * How long a removed skeleton root has shown: the latest any of its bars
 * came into view, and the latest the page drew one (`BarSeen.drawn`), which
 * is Infinity while a bar the compositor faded in has not been drawn yet.
 */
interface Shown {
	since: number;
	drawn: number;
}

/** A skeleton root a change removed: the change, and how long it has shown. */
interface Removed extends Shown {
	record: MutationRecord;
}

let observer: MutationObserver | null = null;

let hold: Hold | null = null;

/** True for an element in content the floor keeps unseen until its skeleton has shown long enough. */
export function waitsUnseen(element: Element): boolean {
	return !!element.closest(WAITING);
}

/** The topmost node `node` hangs from: for a bar that left with a removed subtree, that subtree's root. */
function topOf(node: Node): Node {
	let top = node;

	while (top.parentNode) top = top.parentNode;

	return top;
}

/**
 * The bars that had come into view and have now left the page, with when
 * each came into view. They leave the record of shown bars, so each is
 * weighed once, and a bar that stays keeps its entry as long as it stays.
 */
function leftBars(): Map<Element, BarSeen> {
	const seen = barsSeen();
	const left = new Map<Element, BarSeen>();

	for (const [bar, shown] of seen) {
		if (bar.isConnected) continue;

		left.set(bar, shown);
		seen.delete(bar);
	}

	return left;
}

/**
 * The subtrees these changes removed while one of their bars had shown for
 * less than {@link MIN_SHOWN_MS}, counted from when the page drew it
 * (`BarSeen.drawn`), each with the change that removed it. A bar whose
 * `since` is still to come (still holding, or one whose light started after
 * its fade passed faint, which no frame has drawn past there yet) was never
 * seen, so content that takes its place shows at once. A bar the compositor
 * faded past faint that the page has not drawn yet (`drawn` is Infinity) was
 * seen: it counts from its faint point and holds until {@link MIN_SHOWN_MS}
 * after the next frame (`wait`).
 */
function removedTooSoon(records: MutationRecord[], left: Map<Element, BarSeen>, now: number): Map<Node, Removed> {
	const tops = new Map<Node, Shown>();
	const removed = new Map<Node, Removed>();

	for (const [bar, { since, drawn = since }] of left) {
		if (now < since || now - drawn >= MIN_SHOWN_MS) continue;

		const top = topOf(bar);
		const shown = tops.get(top);

		tops.set(top, {
			since: Math.max(shown?.since ?? -Infinity, since),
			drawn: Math.max(shown?.drawn ?? -Infinity, drawn)
		});
	}

	if (!tops.size) return removed;

	for (const record of records) {
		for (const node of record.removedNodes) {
			const shown = tops.get(node);

			if (shown) removed.set(node, { record, ...shown });
		}
	}

	return removed;
}

/** The elements these changes added to `parent` that are still in it; null when they added text, which can't wait unseen. */
function addedTo(parent: Node, records: MutationRecord[]): Element[] | null {
	const added: Element[] = [];

	for (const record of records) {
		if (record.target !== parent) continue;

		for (const node of record.addedNodes) {
			if (node.parentNode !== parent) continue;
			if (node instanceof Element) added.push(node);
			else if (node.nodeValue?.trim()) return null;
		}
	}

	return added;
}

/**
 * Puts a skeleton's animations back where they were as it left: the hold of
 * each bar that had come into view at the point of its fade it had reached
 * (done, when that is unknown), and the light passing over each bar at its
 * place in the pass (its slow fade at the end, with it). Put back in the
 * page, the skeleton would start them all over and vanish for its wait. A
 * bar shown in full at once has no hold to resume: its style keeps it so.
 */
function resumeBars(root: Element, left: Map<Element, BarSeen>): void {
	for (const animation of root.getAnimations({ subtree: true })) {
		const bar = (animation.effect as KeyframeEffect | null)?.target;

		if (!(animation instanceof CSSAnimation) || !bar) continue;

		if (animation.animationName !== HOLD_ANIMATION) {
			const light = window.__recoderBarLights?.get(bar);

			if (light !== undefined) animation.startTime = light;
		} else if (left.has(bar)) {
			const start = left.get(bar)?.start ?? null;

			if (start === null) animation.finish();
			else animation.startTime = start;
		}
	}
}

/** Readies `parent` to hold content out of flow in the box the content will have. */
function holdIn(parent: HTMLElement): void {
	const style = getComputedStyle(parent);
	const inset = `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`;

	parent.style.setProperty(INSET_PROPERTY, inset);

	if (style.position === 'static') parent.setAttribute(HOST_ATTR, '');
}

/** The pieces of one hold. */
type Pieces = Pick<Hold, 'skeletons' | 'content' | 'parents'>;

/** Opens a hold until `until` with these pieces, or adds them to the open one and keeps it at least that long. */
function extend(pieces: Pieces, until: number): void {
	if (hold) clearTimeout(hold.timer);

	const latest = Math.max(hold?.until ?? until, until);

	hold = {
		skeletons: [...(hold?.skeletons ?? []), ...pieces.skeletons],
		content: [...(hold?.content ?? []), ...pieces.content],
		parents: [...(hold?.parents ?? []), ...pieces.parents],
		until: latest,
		timer: setTimeout(releaseFloor, Math.max(0, latest - performance.now()))
	};
}

/** True for a skeleton, or an element that holds one: a late part's skeleton that lands during a hold. */
function holdsSkeleton(element: Element): boolean {
	return element.matches(HOLDERS) || !!element.querySelector(HOLDERS);
}

/**
 * While a hold is open, content the page adds beside the waiting content
 * waits with it, and a page that moved on (the waiting content gone) ends it.
 * A skeleton the page adds meanwhile is not content: it shows on its own
 * clock rather than staying hidden until the hold ends.
 */
function keepHolding(current: Hold, records: MutationRecord[]): void {
	if (current.content.some((element) => !element.isConnected)) {
		releaseFloor();

		return;
	}

	for (const parent of current.parents) {
		for (const element of addedTo(parent, records) ?? []) {
			if (current.skeletons.includes(element) || holdsSkeleton(element)) continue;

			element.setAttribute(WAITING_ATTR, 'waiting');
			current.content.push(element);
		}
	}
}

/** Which removed skeletons content may wait for, given the content that took their place. */
type Keeps = (skeleton: Element, content: Element[]) => boolean;

/** Any skeleton: on a change within a page, content waits for whichever skeleton it replaced. */
const anySkeleton: Keeps = () => true;

/**
 * True when `skeleton` is, or holds, a page skeleton standing for the page
 * `content` brings: the page root inside it wears the same `data-ui` as one
 * of the elements that took its place (the review page for the review page).
 */
function standsFor(skeleton: Element, content: Element[]): boolean {
	const stand = skeleton.matches(PAGE_SKELETON) ? skeleton : skeleton.querySelector(PAGE_SKELETON);
	const page = stand?.querySelector(':scope > [data-ui]')?.getAttribute('data-ui');

	return !!page && content.some((element) => element.getAttribute('data-ui') === page);
}

/**
 * Counts the skeletons in `content` as in view since `since`. A page's own
 * skeleton that takes the place of the shell's, already in view, shows at
 * once (`handOffOnLeave`), but the page can swap it for its content in the
 * same task, before that hand-off runs, so the floor carries the clock on
 * itself.
 */
function handOn(content: Element[], since: number): void {
	for (const element of content) {
		for (const holder of [element, ...element.querySelectorAll(HOLDERS)]) {
			if (holder.matches(HOLDERS)) markSeen(holder, since);
		}
	}
}

/**
 * Keeps the open hold until {@link MIN_SHOWN_MS} after the next frame, which
 * is the first the page draws with `skeleton` back in it.
 */
function holdPastNextFrame(skeleton: Element): void {
	requestAnimationFrame(() => {
		if (hold?.skeletons.includes(skeleton))
			extend({ skeletons: [], content: [], parents: [] }, performance.now() + MIN_SHOWN_MS);
	});
}

/**
 * Puts the `skeletons` that `keeps` allows back in `parent` in front of the
 * content that replaced them, which waits unseen until the latest of them
 * has shown {@link MIN_SHOWN_MS}, counted from when the page drew it: from
 * the next frame for a skeleton the compositor faded in that the page had
 * not drawn yet. Content waits only when it shows more text than the
 * skeletons did: a skeleton that takes another's place keeps its clock
 * instead (`handOn`).
 */
function wait(
	parent: HTMLElement,
	skeletons: Map<Element, Shown>,
	records: MutationRecord[],
	left: Map<Element, BarSeen>,
	keeps: Keeps
): void {
	const content = addedTo(parent, records);

	if (!content?.length) return;

	const kept = [...skeletons].filter(([skeleton]) => keeps(skeleton, content));
	const back = kept.map(([skeleton]) => skeleton);
	const since = Math.max(...kept.map(([, shown]) => shown.since));
	const drawn = Math.max(...kept.map(([, shown]) => shown.drawn));
	const skeletonText = textLength(back);

	if (!back.length) return;

	if (textLength(content, skeletonText) <= skeletonText) {
		handOn(content, since);

		return;
	}

	for (const element of content) element.setAttribute(WAITING_ATTR, 'waiting');

	holdIn(parent);

	for (const skeleton of back) {
		parent.insertBefore(skeleton, content[0]);
		resumeBars(skeleton, left);
	}

	extend({ skeletons: back, content, parents: [parent] }, Math.min(drawn, performance.now()) + MIN_SHOWN_MS);

	if (drawn === Infinity) holdPastNextFrame(back[0]);

	endBootWait();
}

/**
 * Bars these changes moved (taken out and put back in the same go): the
 * browser starts a moved element's animations over, which would hide a bar
 * in view for its whole wait, so each carries on from where it was.
 */
function resumeMoved(records: MutationRecord[]): void {
	const seen = barsSeen();

	for (const record of records) {
		for (const node of record.removedNodes) {
			if (!(node instanceof Element) || !node.isConnected) continue;

			const moved = [node, ...node.querySelectorAll(HOLDERS)].filter((bar) => seen.has(bar));

			if (moved.length) resumeBars(node, new Map(moved.map((bar) => [bar, seen.get(bar) as BarSeen])));
		}
	}
}

/**
 * Weighs a batch of changes. A skeleton that had been in view for less than
 * {@link MIN_SHOWN_MS} when content took its place goes back where it stood,
 * if `keeps` allows, and the content waits unseen until the skeleton has
 * shown that long. A skeleton inside content that waits was never in view,
 * so it holds nothing back. The floor's own changes are dropped, so it never
 * weighs them.
 */
function weigh(records: MutationRecord[], keeps: Keeps): void {
	resumeMoved(records);

	const left = leftBars();

	if (!left.size) return;

	const removed = removedTooSoon(records, left, performance.now());
	const byParent = new Map<HTMLElement, Map<Element, Shown>>();

	for (const [node, { record, ...shown }] of removed) {
		const parent = record.target;

		if (!(parent instanceof HTMLElement) || !parent.isConnected || !(node instanceof Element)) continue;
		if (waitsUnseen(parent)) continue;

		byParent.set(parent, (byParent.get(parent) ?? new Map()).set(node, shown));
	}

	for (const [parent, skeletons] of byParent) wait(parent, skeletons, records, left, keeps);

	observer?.takeRecords();
}

/** Runs after each change to the canvas: content added beside a hold waits with it, then the changes are weighed. */
function onMutations(records: MutationRecord[]): void {
	if (hold) keepHolding(hold, records);

	weigh(records, anySkeleton);
}

/** Starts weighing each change to the canvas, once; the skeleton roots call it as they mount. */
export function watchFloor(): void {
	const canvas = document.getElementById('app-canvas');

	if (observer || !canvas) return;

	observer = new MutationObserver(onMutations);
	observer.observe(canvas, { childList: true, subtree: true });
}

/**
 * Counts the skeletons inside content that waited as in view from `shownAt`
 * at the earliest: one that started to show while the content was unseen
 * comes into view only as the content does.
 */
function inViewFrom(content: Element, shownAt: number): void {
	for (const holder of content.querySelectorAll(HOLDERS)) {
		const seen = barsSeen().get(holder);

		if (seen) seen.since = Math.max(seen.since, shownAt);
	}
}

/**
 * Ends the open hold: the skeletons put back leave and the content shows,
 * its own transitions off until a frame has painted it. The changes that
 * brings are dropped, so the floor never weighs its own.
 */
function releaseFloor(): void {
	const current = hold;

	hold = null;
	observer?.takeRecords();

	if (!current) return;

	clearTimeout(current.timer);

	for (const skeleton of current.skeletons) {
		for (const bar of [skeleton, ...skeleton.querySelectorAll(HOLDERS)]) barsSeen().delete(bar);

		skeleton.remove();
	}

	for (const parent of current.parents) {
		parent.removeAttribute(HOST_ATTR);
		parent.style.removeProperty(INSET_PROPERTY);
	}

	const shownAt = performance.now();

	for (const element of current.content) {
		element.setAttribute(WAITING_ATTR, 'shown');
		inViewFrom(element, shownAt);
	}

	requestAnimationFrame(() =>
		requestAnimationFrame(() => {
			for (const element of current.content) {
				if (element.getAttribute(WAITING_ATTR) === 'shown') element.removeAttribute(WAITING_ATTR);
			}
		})
	);

	observer?.takeRecords();
}

/**
 * Called as a navigation commits, and as the shell's skeleton takes the
 * place of the page a navigation leaves, from the commit's layout effects:
 * the commit's changes are still queued, so they are taken first. The old
 * page's hold ends, and of the skeletons the commit removed, content waits
 * only for a page skeleton that stood for the page now landing (`standsFor`):
 * the shell's, drawn at once in the old page's place, keeps its
 * {@link MIN_SHOWN_MS} like any other. A new page never waits on the old
 * page's own skeleton.
 */
export function floorOnNavigation(): void {
	const records = observer?.takeRecords() ?? [];

	releaseFloor();
	watchFloor();
	weigh(records, standsFor);
}
