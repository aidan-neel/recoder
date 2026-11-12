import { BOOT_FAILED_ATTR, LOST_SCRIPT_ATTR } from './boot-script';
import { lateArrival, useShell } from './shell-store';

/** The shell store's state, as the watch reads it. */
type Shell = ReturnType<typeof useShell.getState>;

/**
 * How long the page the app loaded on may keep its skeleton, after a script
 * failed before the app mounted, before the page gives up on it.
 */
const STUCK_MS = 1500;

/**
 * True while a route's skeleton stands in the canvas: the boot frame's, the
 * one the shell draws for a page the router is still getting, or the one a
 * page shows while its code is on its way.
 */
export function routeWaits(): boolean {
	return !!document.querySelector('[data-ui="page-skeleton"]');
}

/**
 * Takes the boot watchdog's notice down, node and all, so no hidden alert
 * stays in the page; the skeleton it hid comes back.
 */
export function clearBootNotice(): void {
	document.documentElement.removeAttribute(BOOT_FAILED_ATTR);
	document.querySelector('[data-ui="boot-notice"]')?.remove();
}

/**
 * True when the app mounts on a route that still waits for its page after
 * one of the app's scripts failed to load. The boot notice then stays up,
 * with the skeleton hidden, until {@link watchStuckRoute} settles it.
 */
export function routeWaitsOnLostScript(): boolean {
	return document.documentElement.hasAttribute(LOST_SCRIPT_ATTR) && routeWaits();
}

/**
 * Finds the page the app loaded on stuck. It runs only when the boot script
 * saw one of the app's scripts fail before the app mounted, and judges only
 * that first page: `onChange` gets its path once its skeleton has outstayed
 * {@link STUCK_MS}, and null when it renders after all or the canvas moves to
 * another page. Such a page can wait for good: when the file failed before
 * the app's runtime asked for it, the runtime waits on a file that never
 * comes and no error reaches React. The verdict comes back at once if the
 * person returns while it still waits.
 *
 * Any app script lost before mount arms it, since the runtime gives no sign
 * of which file it waits on. The scripts in the first page's HTML are the
 * ones its route asked for, the boot notice has already said a part did not
 * load, and a page whose code was only slow loses the verdict the moment it
 * renders. A script lost after mount never counts: the runtime retries it,
 * and its loss reaches the code that asked for it (for a page, React's error
 * boundary, whose notice reloads once through `useChunkReload`).
 *
 * The watch follows the canvas only while the first page is shown or on its
 * way, or the boot notice is still up; a page that renders takes that notice
 * down. It ends once the router has settled on the first page and the page
 * shows. Returns the cleanup.
 */
export function watchStuckRoute(onChange: (stuckAt: string | null) => void): () => void {
	const root = document.documentElement;

	if (!root.hasAttribute(LOST_SCRIPT_ATTR)) return () => {};

	const first = useShell.getState().pathname;
	let judged = false;
	let verdict: string | null = null;
	let following = false;
	let stopped = false;

	function settle(next: string | null): void {
		if (next === verdict) return;

		verdict = next;
		onChange(next);
	}

	/**
	 * True while the canvas can still matter: the first page is on screen or
	 * on its way (the router is on it, or a navigation heads back to it), or
	 * the boot notice waits for a page to render.
	 */
	function watching(state: Shell): boolean {
		return state.pathname === first || state.arriving?.path === first || root.hasAttribute(BOOT_FAILED_ATTR);
	}

	/**
	 * True once the router has settled on the first page, with no navigation
	 * in flight. Only then does the canvas belong to that page: the store
	 * moves before React draws, so a page arriving late can read the old
	 * page's canvas, which shows no skeleton.
	 */
	function onFirst(state: Shell): boolean {
		return state.pathname === first && !state.arriving;
	}

	/**
	 * A new verdict needs the canvas to stand for the first page: on screen
	 * with no navigation leaving it, or arriving late. One already given holds
	 * while a navigation away has not yet taken the canvas.
	 */
	function judge(state: Shell): void {
		const waits = routeWaits();

		if (!waits) clearBootNotice();

		if (!waits && onFirst(state)) {
			stop();
			root.removeAttribute(LOST_SCRIPT_ATTR);
			settle(null);

			return;
		}

		const shown = lateArrival(state) ?? state.pathname;
		const judging = state.arriving ? lateArrival(state) : state.pathname;
		const holds = verdict !== null && shown === first;

		settle(judged && waits && (holds || judging === first) ? first : null);
	}

	function update(): void {
		const state = useShell.getState();

		if (watching(state)) judge(state);
		else settle(null);

		follow(!stopped && watching(state));
	}

	const observer = new MutationObserver(() => update());

	/** Starts or stops reading the canvas's changes: far from the first page, only the store's changes matter. */
	function follow(on: boolean): void {
		if (on === following) return;

		following = on;

		if (on) observer.observe(document.body, { childList: true, subtree: true });
		else observer.disconnect();
	}

	const timer = setTimeout(() => {
		judged = true;
		root.removeAttribute(LOST_SCRIPT_ATTR);
		update();
	}, STUCK_MS);

	const stopFollowing = useShell.subscribe(() => update());

	function stop(): void {
		stopped = true;
		clearTimeout(timer);
		follow(false);
		stopFollowing();
	}

	follow(true);

	return stop;
}
