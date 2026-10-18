/**
 * A handler per key, as `KeyboardEvent.key` names it (`j`, `ArrowDown`, `Enter`, `mod+k`, `' '` for Space).
 * A handler that returns exactly `false` passes the key on: the browser keeps its default and no keycap presses.
 */
export type KeyMap = Record<string, (event: KeyboardEvent) => unknown>;

/** Keycaps stay pressed this long after their key fires, so the press reads at 60fps. */
export const FLASH_MS = 140;

/** Keys that move or scroll, which may repeat while held. Every other key fires once per press. */
const REPEATS = new Set(['j', 'k', 'ArrowDown', 'ArrowUp', ' ', 'PageDown', 'PageUp']);

/** Keys that walk a list. They stand down inside a region that reads its own content. */
const MOVES = new Set(['j', 'k', 'ArrowDown', 'ArrowUp']);

/** Arrow keys, which a focused control may use for itself. */
const ARROWS = new Set(['ArrowDown', 'ArrowUp']);

/** Regions whose own keys win over the page's moves: the ask panel scrolls and reads its conversation. */
const OWN_MOVES = '[data-ask-panel]';

/** The top bar: its tabs, search trigger and settings gear sit outside the page and never use a move key. */
const CHROME = '[data-ui="top-bar"]';

/** Open overlays that silence page keys. One playing its closing animation (`data-state="closed"`) does not count. */
const OVERLAYS = ['dialog', 'alertdialog', 'menu', 'listbox']
	.map((role) => `[role="${role}"]:not([data-state="closed"])`)
	.join();

/** True when the event comes from a field the person is typing in. */
function typing(target: EventTarget | null): boolean {
	const element = target as HTMLElement | null;

	return !!element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));
}

/** The key map name for a press: `mod+k` with Cmd or Ctrl held, else the key itself, letters lowercased. */
function name(event: KeyboardEvent): string {
	const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

	return event.metaKey || event.ctrlKey ? `mod+${key}` : key;
}

/** The focused element, or null when focus rests on the page itself. */
function focusedElement(target: EventTarget | null): Element | null {
	const element = target instanceof Element ? target : null;

	return element === document.body || element === document.documentElement ? null : element;
}

/**
 * Enter and Space on a focused button or link belong to that control. A
 * control marked `data-page-keys="all"` (a rail row that is already
 * selected, so pressing it would do nothing) hands them to the page.
 */
function activates(event: KeyboardEvent): boolean {
	const target = focusedElement(event.target);

	if ((event.key !== 'Enter' && event.key !== ' ') || !target?.closest('button, a[href], [role="button"]'))
		return false;

	return target.getAttribute('data-page-keys') !== 'all';
}

/**
 * True when a focused control keeps a move key for itself. Moves stand down
 * inside a region that reads its own content; arrows also stand down on any
 * focused element except the page itself, the top bar's controls and
 * elements marked `data-page-keys` (rail rows, the reading pane), which let
 * the page step through them.
 */
function keepsMove(key: string, target: EventTarget | null): boolean {
	if (!MOVES.has(key)) return false;

	const element = focusedElement(target);

	if (element?.closest(OWN_MOVES)) return true;

	return ARROWS.has(key) && !!element && !element.hasAttribute('data-page-keys') && !element.closest(CHROME);
}

/**
 * A move the page took lets go of a top-bar control still focused from a
 * click (a tab link, the search trigger, the settings gear), so the next
 * Enter goes to the page instead of that control.
 */
function leaveChrome(key: string, target: EventTarget | null): void {
	const element = focusedElement(target);

	if (MOVES.has(key) && element instanceof HTMLElement && element.closest(CHROME)) element.blur();
}

/** True while any dialog, menu or listbox is open, so page shortcuts stand down. */
function overlayOpen(): boolean {
	return !!document.querySelector(OVERLAYS);
}

/**
 * Press every keycap labelled for `key` (`<kbd data-ui="keycap" data-key="a">`),
 * so a shortcut visibly presses the button it names.
 */
export function flashKey(key: string): void {
	for (const cap of document.querySelectorAll<HTMLElement>(`[data-ui="keycap"][data-key="${CSS.escape(key)}"]`)) {
		cap.dataset.pressed = '';
		setTimeout(() => delete cap.dataset.pressed, FLASH_MS);
	}
}

/** True when a plain key should stand down: the person types, a dialog is open, or a focused control owns the key. */
function standsDown(event: KeyboardEvent, key: string): boolean {
	return typing(event.target) || overlayOpen() || activates(event) || keepsMove(key, event.target);
}

/**
 * Listen for page shortcuts on the window. Plain keys are ignored while the
 * person types, a dialog is open or a focused control owns the key, and a
 * held key repeats only when it moves or scrolls; `mod+` keys always fire,
 * and Esc leaves a text field so the keyboard flow can carry on. Returns the
 * cleanup.
 */
export function listenKeys(map: () => KeyMap): () => void {
	function onKey(event: KeyboardEvent): void {
		const key = name(event);

		if (event.defaultPrevented || event.isComposing || event.altKey || (event.repeat && !REPEATS.has(key))) return;

		if (event.key === 'Escape' && typing(event.target)) {
			(event.target as HTMLElement).blur();

			return;
		}

		if (!key.startsWith('mod+') && standsDown(event, key)) return;

		const handler = map()[key];

		if (!handler || handler(event) === false) return;

		event.preventDefault();
		flashKey(key);
		leaveChrome(key, event.target);
	}

	window.addEventListener('keydown', onKey);

	return () => window.removeEventListener('keydown', onKey);
}
