/**
 * A handler per key, as `KeyboardEvent.key` names it (`j`, `ArrowDown`, `Enter`, `mod+k`, `' '` for Space), or with
 * Alt (Option) held as the key's place on the keyboard names it (`alt+t`, `alt+shift+t`, `alt+1`, `alt+[`).
 * A handler that returns exactly `false` passes the key on: the browser keeps its default and no keycap presses.
 */
export type KeyMap = Record<string, (event: KeyboardEvent) => unknown>;

/** Keycaps stay pressed this long after their key fires, so the press reads at 60fps. */
const FLASH_MS = 140;

/** Keys that move or scroll, which may repeat while held. Every other key fires once per press. */
const REPEATS = new Set(['j', 'k', 'ArrowDown', 'ArrowUp', ' ', 'PageDown', 'PageUp']);

/** Keys that walk a list. */
const MOVES = new Set(['j', 'k', 'ArrowDown', 'ArrowUp']);

/** Arrow keys, which a focused control may use for itself. */
const ARROWS = new Set(['ArrowDown', 'ArrowUp']);

/** The sidebar and a page's bar: their links and buttons sit outside the page's content and never use a move key. */
const CHROME = '[data-chrome]';

/** Open overlays that silence page keys. One playing its closing animation (`data-state="closed"`) does not count. */
const OVERLAYS = ['dialog', 'alertdialog', 'menu', 'listbox']
	.map((role) => `[role="${role}"]:not([data-state="closed"])`)
	.join();

/** True when the event comes from a field the person is typing in. */
function typing(target: EventTarget | null): boolean {
	const element = target as HTMLElement | null;

	return !!element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));
}

/** Keys an Alt shortcut names by their place on the keyboard, beyond letters and digits. */
const CODE_KEYS: Record<string, string> = { BracketLeft: '[', BracketRight: ']' };

/**
 * The key a press with Alt held names. Option on a Mac types another character (`†` for T), so the key's place on
 * the keyboard names it: a letter, a digit or a bracket.
 */
function altKey(event: KeyboardEvent): string {
	const key = /^(Key[A-Z]|Digit\d)$/.test(event.code) ? event.code.slice(-1).toLowerCase() : CODE_KEYS[event.code];

	return `alt+${event.shiftKey ? 'shift+' : ''}${key ?? event.code}`;
}

/**
 * The key map name for a press: `mod+k` with Cmd or Ctrl held, `alt+t` with Alt held alone, else the key itself,
 * letters lowercased.
 */
function name(event: KeyboardEvent): string {
	if (event.altKey) return altKey(event);

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
 * control marked `data-page-keys="all"` (a row that is already selected, so
 * pressing it would do nothing) hands them to the page.
 */
function activates(event: KeyboardEvent): boolean {
	const target = focusedElement(event.target);

	if ((event.key !== 'Enter' && event.key !== ' ') || !target?.closest('button, a[href], [role="button"]'))
		return false;

	return target.getAttribute('data-page-keys') !== 'all';
}

/**
 * True when a focused control keeps an arrow key for itself: any focused
 * element except the page itself, the chrome's controls and elements marked
 * `data-page-keys` (list rows, file cards), which let the page step through
 * them.
 */
function keepsArrow(key: string, target: EventTarget | null): boolean {
	if (!ARROWS.has(key)) return false;

	const element = focusedElement(target);

	return !!element && !element.hasAttribute('data-page-keys') && !element.closest(CHROME);
}

/**
 * A move the page took lets go of a chrome control still focused from a
 * click (a sidebar link, a tab, a bar button), so the next Enter goes to the
 * page instead of that control.
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
function flashKey(key: string): void {
	for (const cap of document.querySelectorAll<HTMLElement>(`[data-ui="keycap"][data-key="${CSS.escape(key)}"]`)) {
		cap.dataset.pressed = '';
		setTimeout(() => delete cap.dataset.pressed, FLASH_MS);
	}
}

/**
 * True for a shortcut that fires even in a field: `mod+` keys, and Alt with a letter or a digit, whose characters
 * (`†`, `™` on a Mac) nobody types on purpose. Alt with a bracket stays with the field, as on a Mac it types quotes.
 */
function firesWhileTyping(key: string): boolean {
	return key.startsWith('mod+') || /^alt\+(shift\+)?[a-z0-9]$/.test(key);
}

/** True when a plain key should stand down: the person types, a dialog is open, or a focused control owns the key. */
function standsDown(event: KeyboardEvent, key: string): boolean {
	return typing(event.target) || overlayOpen() || activates(event) || keepsArrow(key, event.target);
}

/**
 * Listen for page shortcuts on the window. Plain keys are ignored while the
 * person types, a dialog is open or a focused control owns the key, and a
 * held key repeats only when it moves or scrolls; `mod+` keys and Alt with a
 * letter or digit always fire,
 * and Esc leaves a text field so the keyboard flow can carry on. Alt held with
 * Cmd or Ctrl is left alone: on Windows that is AltGr, which types characters.
 * Returns the cleanup.
 */
export function listenKeys(map: () => KeyMap): () => void {
	function onKey(event: KeyboardEvent): void {
		const key = name(event);

		const altGr = event.altKey && (event.ctrlKey || event.metaKey);

		if (event.defaultPrevented || event.isComposing || altGr || (event.repeat && !REPEATS.has(key))) return;

		if (event.key === 'Escape' && typing(event.target)) {
			(event.target as HTMLElement).blur();

			return;
		}

		if (!firesWhileTyping(key) && standsDown(event, key)) return;

		const handler = map()[key];

		if (!handler || handler(event) === false) return;

		event.preventDefault();
		flashKey(key);
		leaveChrome(key, event.target);
	}

	window.addEventListener('keydown', onKey);

	return () => window.removeEventListener('keydown', onKey);
}
