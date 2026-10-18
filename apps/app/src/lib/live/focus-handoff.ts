/**
 * The views that take focus from a control that leaves as a review moves on:
 * the live view (after Start review, or the notice's Continue) and the notice
 * over a stopped review (after Cancel review is confirmed).
 */
export type FocusHeir = 'live' | 'notice';

/** The view asked to take focus next, if any. */
let pending: FocusHeir | null = null;

/**
 * Runs an action whose control leaves with the view it is in, and asks
 * `heir` to take focus when it shows, so focus does not fall to the page. A
 * failure drops the request, since the control stays and keeps focus.
 */
export async function handFocus(heir: FocusHeir, action: () => Promise<unknown>): Promise<void> {
	pending = heir;

	try {
		await action();
	} catch (error) {
		if (pending === heir) pending = null;

		throw error;
	}
}

/**
 * Takes a request meant for `heir`: focuses `target` when focus fell to the
 * page with the control that asked. Call it in a layout effect as the view
 * shows or changes, so a dialog closing in the same commit leaves focus be.
 */
export function takeFocus(heir: FocusHeir, target: HTMLElement | null): void {
	if (pending !== heir) return;

	pending = null;

	const active = document.activeElement;

	if (!active || active === document.body) target?.focus({ preventScroll: true });
}
