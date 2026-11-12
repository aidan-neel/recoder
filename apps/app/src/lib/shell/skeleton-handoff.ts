import { beforeMount } from './mounted';
import {
	BOOT_WAIT_ATTR,
	endBootWait,
	guessLights,
	HOLD_ANIMATION,
	HOLDERS,
	isHold,
	LIGHT_ANIMATION,
	markSeen,
	noteHoldStart,
	seenSince,
	textLength
} from './skeleton-bars';
import { floorOnNavigation, waitsUnseen, watchFloor } from './skeleton-floor';

/** An episode stops following the page after this long, even with a skeleton still on it. */
const EPISODE_CAP_MS = 10_000;

/**
 * How long a skeleton's fade runs before it can be read: the kit's 140ms
 * ease-in stays under 5% opacity for its first 25ms. A bar counts as in view
 * once its fade passes that point on screen (`WATCH_BARS_SCRIPT`).
 */
const FADE_UNSEEN_MS = 25;

/** The skeletons in the canvas: a page that mounts with none (a 404, or one that came whole) has nothing to hold. */
const CANVAS_HOLDERS = HOLDERS.split(',')
	.map((holder) => `#app-canvas ${holder.trim()}`)
	.join(',');

/**
 * The boot script's part that runs the server's skeleton holds. It sets the
 * full load's longer wait ({@link BOOT_WAIT_ATTR}), which {@link endBootWait}
 * takes off again, and which goes as the app mounts when the canvas then
 * holds no skeleton (a 404), since no episode would end it. It dates the
 * holds from the first paint: the browser dates a hold when its compositor
 * starts it, which on a busy start can come tens of milliseconds after the
 * paint, so once the paint is reported every hold still waiting moves back
 * to it (or to the earliest hold already running), never later. That runs
 * between tasks, before the app has mounted; after that the hand-off owns
 * the clock.
 *
 * For the skeleton floor (`skeleton-floor.ts`) it follows the bars for the
 * whole page from the first paint on. A canvas bar's hold ending its wait,
 * or a bar's light starting, queues the bar, and the frame that event came
 * in reads the page's animations once for all the bars queued in it (a
 * callback asked for while the browser hands out the frame's animation
 * events runs in that same frame). Reading them per event would cost a style
 * pass and a walk over every animation for each of the hundred bars a page
 * starts at once. That read records when each light started, so a skeleton
 * put back carries on where it was, and when each hold started. A bar whose
 * light started before its fade passed {@link FADE_UNSEEN_MS} was already
 * on screen, and the compositor runs its fade on its own, even while a long
 * task holds back the page's frames, so it counts as in view from the time
 * its fade passes that point. Any other bar (one first drawn with its fade
 * past that point, or one with no light) counts from the first frame the
 * page draws with its fade past there, so one a long task kept off screen
 * was never seen. Every bar read also records that frame as when the page
 * drew it (`BarSeen.drawn`), which is what the floor times its hold from.
 * That is the time the page draws the frame, not the frame's own time: a
 * long task can start a frame well after its time, and the frame shows only
 * once drawn. A hold's fade ending marks the bar as showing in full.
 */
export const WATCH_BARS_SCRIPT = `var shown=new WeakSet(),seen=new Map(),lights=new WeakMap(),queued=[],fading=[],asked=0,hold=${JSON.stringify(HOLD_ANIMATION)},light=${JSON.stringify(LIGHT_ANIMATION)},wait=${JSON.stringify(BOOT_WAIT_ATTR)},root=document.documentElement;window.__recoderShownBars=shown;window.__recoderBarsSeen=seen;window.__recoderBarLights=lights;
root.setAttribute(wait,'');
new MutationObserver(function(r,o){if(!root.hasAttribute('data-mounted'))return;o.disconnect();if(!document.querySelector(${JSON.stringify(CANVAS_HOLDERS)}))root.removeAttribute(wait);}).observe(root,{attributes:true,attributeFilter:['data-mounted']});
function ask(){if(!asked)asked=requestAnimationFrame(read);}
function read(now){var due=new Set(queued),holds=[];asked=0;queued=[];if(due.size)document.getAnimations().forEach(function(a){var t=a.effect&&a.effect.target;if(!due.has(t)||a.startTime===null)return;if(a.animationName===light)lights.set(t,Number(a.startTime));else if(a.animationName===hold)holds.push(a);});holds.forEach(function(a){var t=a.effect.target,last=seen.get(t),start=Number(a.startTime),past=Number(a.effect.getComputedTiming().delay)+${FADE_UNSEEN_MS},early=lights.get(t)<start+past;seen.set(t,{since:Math.min(last?last.since:Infinity,early?start+past:Infinity),start:start,drawn:last&&last.drawn<Infinity?last.drawn:Infinity});fading.push([t,past]);});fading=fading.filter(function(f){var entry=seen.get(f[0]),at;if(!entry||!f[0].isConnected)return false;if(entry.start+f[1]>now)return true;at=performance.now();entry.since=Math.min(entry.since,at);if(entry.drawn===Infinity)entry.drawn=at;return false;});if(fading.length)ask();}
addEventListener('animationend',function(e){if(e.animationName===hold)shown.add(e.target);},true);
addEventListener('animationstart',function(e){var t=e.target;if(e.animationName===light||e.animationName===hold&&t.closest&&t.closest('#app-canvas')){queued.push(t);ask();}},true);
try{new PerformanceObserver(function(list,observer){var paint=list.getEntries()[0];if(!paint)return;observer.disconnect();var holds=document.getAnimations().filter(function(a){return a.animationName===hold;}),from=paint.startTime;if(root.hasAttribute('data-mounted'))return;holds.forEach(function(a){if(a.startTime!==null&&Number(a.startTime)<from)from=Number(a.startTime);});holds.forEach(function(a){if(a.startTime===null||Number(a.startTime)>from)a.startTime=from;});window.__recoderHoldStart=from;}).observe({type:'paint',buffered:true});}catch(e){}`;

/**
 * One loading episode: the skeletons that take each other's place while one
 * page loads (the server's frame, then the page's own skeleton; the shell's
 * skeleton for a page arriving, then the page's). Their holds all run from
 * the episode's start, so a skeleton that replaces another never starts its
 * wait again.
 */
interface Episode {
	/** When the episode's hold began, on the animations' clock; minus infinity shows its skeletons in full at once. */
	from: number;
	/** When its skeletons came into view, on the page's clock; infinity while none has. */
	seen: number;
	/** True from a hand-off until the commit that made it has been seen. */
	carry: boolean;
	/**
	 * The most text a skeleton that handed on its clock held (settings' page
	 * skeleton carries its nav and title): a commit that shows more has
	 * brought the page's content.
	 */
	text: number;
	observer: MutationObserver;
	cap: ReturnType<typeof setTimeout>;
}

/** What the canvas shows: some text, only skeletons (or a page skeleton), or nothing yet. */
type CanvasState = 'content' | 'skeleton' | 'empty';

let episode: Episode | null = null;

/**
 * Now on the animations' clock. It moves once a frame, so during a long task
 * it lags the page's clock; a start set from the page's clock would land a
 * finished hold halfway through its fade.
 */
function timelineNow(): number {
	return Number(document.timeline.currentTime ?? performance.now());
}

/**
 * Every element in the canvas that runs the hold, leaving out any in a menu
 * or a dialog, and any in content the skeleton floor keeps unseen: a late
 * part's skeleton there holds on its own clock, from when the content shows.
 */
function canvasHolders(): HTMLElement[] {
	const holders = document.getElementById('app-canvas')?.querySelectorAll<HTMLElement>(HOLDERS) ?? [];

	return [...holders].filter((holder) => !waitsUnseen(holder));
}

/**
 * Every skeleton hold in the canvas. Asking an element for its animations
 * computes styles, so the bars a commit just added have theirs.
 */
function canvasHolds(): CSSAnimation[] {
	return canvasHolders().flatMap((holder) => holder.getAnimations().filter(isHold));
}

/**
 * Moves a hold's start back to `from`, or to the latest start that has it
 * already done. A start only ever moves earlier, so a bar that shows never
 * hides again, and one halfway through its fade carries on from there.
 */
function pin(animation: CSSAnimation, from: number): void {
	const end = Number(animation.effect?.getComputedTiming().endTime ?? 0);
	const start = Math.max(from, timelineNow() - end);
	const current = animation.startTime === null ? Infinity : Number(animation.startTime);

	if (start >= current) return;

	animation.startTime = start;

	if (animation.effect instanceof KeyframeEffect && animation.effect.target)
		noteHoldStart(animation.effect.target, start);
}

/** True once a hold has passed its wait, so its bar draws. */
function pastWait(animation: CSSAnimation): boolean {
	const timing = animation.effect?.getComputedTiming();

	return Number(animation.currentTime ?? 0) > Number(timing?.delay ?? 0);
}

/**
 * Shows every skeleton in the canvas in full, bars and the queue skeleton's
 * dividers alike, with no hold and no fade, and records them as shown, since
 * no hold will end to say so. It only writes, so unlike pinning it costs the
 * commit no style work: the browser computes their styles once, for the
 * frame that paints them. That frame records them as in view since then (or
 * since `seen`, when earlier), with their light starting then: the moment it
 * runs, not the frame's own time, which a long task can leave well behind.
 * A skeleton gone before any frame drew it was never in view.
 */
function showCanvas(seen: number): void {
	const holders = canvasHolders();

	for (const holder of holders) {
		holder.style.animation = 'none';
		window.__recoderShownBars?.add(holder);
	}

	requestAnimationFrame(() => {
		const drawn = performance.now();

		for (const holder of holders) {
			if (!holder.isConnected) continue;

			markSeen(holder, Math.min(seen, drawn));
			guessLights(holder, drawn);
		}
	});
}

/**
 * Puts the canvas's skeletons on the episode's clock: in full at once, or
 * pinned to its start. A bar that draws at once carries on the episode's
 * skeleton already in view, so it counts as in view since that one was.
 */
function holdCanvas({ from, seen }: Episode): void {
	if (from === -Infinity) {
		showCanvas(seen);

		return;
	}

	for (const animation of canvasHolds()) {
		pin(animation, from);

		if (seen !== Infinity && pastWait(animation) && animation.effect instanceof KeyframeEffect) {
			const bar = animation.effect.target;

			if (bar) markSeen(bar, seen, Number(animation.startTime));
		}
	}
}

/**
 * Text that frames a page rather than being its content: its nav and its
 * title, and the words of a region marked as loading that holds a skeleton
 * (a settings group's title and button, above rows still on their way).
 */
const FRAME = `nav, h1, [aria-busy="true"]:has(${HOLDERS})`;

/**
 * What the canvas shows now. A page skeleton counts as skeleton, and so does
 * a page whose only words are its frame ({@link FRAME}) beside a skeleton:
 * settings landing with its nav, title and group titles while its rows load.
 */
function canvasState(): CanvasState {
	const canvas = document.getElementById('app-canvas');

	if (!canvas) return 'empty';
	if (canvas.querySelector('[data-ui="page-skeleton"]')) return 'skeleton';
	if (textLength([canvas], 0, FRAME) > 0) return 'content';

	return canvas.querySelector('[data-ui="skeleton"]') ? 'skeleton' : 'empty';
}

/**
 * Ends the open episode: skeletons mounted from now on hold for their own
 * `--skeleton-delay`. The full load's first episode ending ends its longer
 * wait too.
 */
function endEpisode(): void {
	endBootWait();

	if (!episode) return;

	episode.observer.disconnect();
	clearTimeout(episode.cap);
	episode = null;
}

/** True when the canvas shows more text than `text`, the most a skeleton that handed on its clock held. */
function contentLanded(text: number): boolean {
	const canvas = document.getElementById('app-canvas');

	return !!canvas && textLength([canvas], text) > text;
}

/**
 * Runs after each commit while an episode is open. A hand-off's commit (the
 * page's own skeleton beside the nav its page skeleton showed too), and any
 * commit that leaves only skeletons in the canvas beside the page's frame,
 * puts its holds on the episode's clock. A commit that shows content ends
 * it, without touching them, even when a skeleton handed off as it left: a
 * late part's skeleton that lands with the content stands where no bar stood
 * and holds on its own, so a fast answer never flashes it. An empty canvas
 * keeps the episode open.
 */
function follow(): void {
	const open = episode;

	if (!open) return;

	const state = canvasState();
	const handOff = open.carry && !(state === 'content' && contentLanded(open.text));

	if (handOff || state === 'skeleton') holdCanvas(open);

	open.carry = false;

	if (state === 'content') endEpisode();
}

/**
 * Opens an episode whose holds run from `from`, whose skeletons have been in
 * view since `seen`, and whose skeleton that handed on its clock held `text`,
 * or folds them into the one already open, where the earlier time and the
 * most text win. The commit under way is put on the episode's clock once it
 * is done, before the browser paints it, and every commit after it until the
 * content shows.
 */
function startEpisode(from: number, seen: number, text: number): void {
	if (episode) {
		episode.from = Math.min(episode.from, from);
		episode.seen = Math.min(episode.seen, seen);
		episode.text = Math.max(episode.text, text);
		episode.carry = true;
	} else {
		const observer = new MutationObserver(follow);

		observer.observe(document.getElementById('app-canvas') ?? document.body, { childList: true, subtree: true });
		episode = { from, seen, carry: true, text, observer, cap: setTimeout(endEpisode, EPISODE_CAP_MS) };
	}

	queueMicrotask(follow);
}

/** True once the skeleton `root` is, or the first one in it, has passed its hold and fade, so it shows in full. */
function holdShows(root: Element): boolean {
	const holder = root.matches(HOLDERS) ? root : root.querySelector(HOLDERS);

	return !!holder && !!window.__recoderShownBars?.has(holder);
}

/**
 * When the server's skeleton started its hold, wait included, on the
 * animations' clock: the start the boot script gave the holds once the
 * first paint was reported, else the first paint itself, else (before any
 * paint) the next frame.
 */
function serverHoldStart(): number {
	return window.__recoderHoldStart ?? performance.getEntriesByType('paint')[0]?.startTime ?? timelineNow();
}

/**
 * When a skeleton mounting now starts its hold: the server's frame (hydrated
 * before the app has mounted) when its first frame painted, others at the
 * open episode's start while one runs, else now.
 */
function holdStart(): number {
	if (beforeMount()) return serverHoldStart();

	return Math.min(episode?.from ?? Infinity, timelineNow());
}

/**
 * Where the clock a leaving skeleton hands on starts: at minus infinity when
 * its bars already show, else at the open episode's start when that is
 * earlier than its own (a skeleton that mounted with a navigation, before the
 * navigation's episode opened), else at its own.
 */
function handedClock(root: HTMLElement | null, since: number): number {
	if (root && holdShows(root)) return -Infinity;

	return Math.min(episode?.from ?? Infinity, since);
}

/**
 * A skeleton root's ref. When the skeleton leaves, the skeleton that takes
 * its place keeps its clock: it shows when this one would have, at once when
 * this one already showed, instead of blinking out for a hold of its own.
 * The cleanup runs as the element is removed, while its bars and the open
 * episode can still be read; the hand-off waits for the commit to finish and
 * happens only if the element is gone by then. React's strict mode detaches
 * a ref right after mounting it in dev, with the element still in place, and
 * that is no leave. The skeleton that takes its place also counts as in view
 * since this one came into view, so the skeleton floor (`skeleton-floor.ts`,
 * whose watch on the canvas the first mount starts) does not hold content
 * back for a skeleton the person has already been looking at.
 */
export const handOffOnLeave = (root: HTMLElement | null) => {
	const since = holdStart();

	watchFloor();

	return () => {
		const from = handedClock(root, since);
		const seen = root ? seenSince(root) : Infinity;
		const text = root ? textLength([root]) : 0;

		queueMicrotask(() => {
			if (!root?.isConnected) startEpisode(from, seen, text);
		});
	};
};

/**
 * Called as a navigation commits, and as the shell's skeleton for a page
 * still arriving takes the place of the page a navigation leaves. A
 * skeleton that now stands where the page the person was looking at stood
 * shows in full at once, with no hold and no fade: a blank or fading canvas
 * after a click reads as a black screen. A page that lands with only its
 * frame counts as a skeleton, or its empty cards would show for the hold. A
 * page that lands with its content keeps the usual hold on any late part's
 * skeleton, the kit's own, since a navigation ends the full load's longer
 * wait. Content kept waiting on the old page's skeleton shows at once, but
 * a skeleton the shell drew for the page now landing keeps the floor
 * (`floorOnNavigation`).
 */
export function showSkeletonsAfterNavigation(): void {
	endBootWait();
	floorOnNavigation();

	queueMicrotask(() => {
		if (canvasState() !== 'content') startEpisode(-Infinity, Infinity, 0);
	});
}
