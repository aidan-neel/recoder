/** A handler per key, as `KeyboardEvent.key` names it (`j`, `ArrowDown`, `Enter`, `mod+k`). */
export type KeyMap = Record<string, (event: KeyboardEvent) => void>;

/** Keycaps stay pressed this long after their key fires, so the press reads at 60fps. */
const FLASH_MS = 140;

function typing(target: EventTarget | null): boolean {
	const element = target as HTMLElement | null;

	return !!element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));
}

function name(event: KeyboardEvent): string {
	const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

	return event.metaKey || event.ctrlKey ? `mod+${key}` : event.shiftKey && key === '?' ? '?' : key;
}

/** True while any dialog or menu is open, so page shortcuts stand down. */
function overlayOpen(): boolean {
	return !!document.querySelector(
		'[data-ui="modal-panel"], [data-ui="dropdown-menu-content"], [data-ui="sheet-content"]'
	);
}

/**
 * Press every keycap labelled for `key` (`<kbd class="keycap" data-key="a">`),
 * so a shortcut visibly presses the button it names.
 */
function flashKey(key: string): void {
	for (const cap of document.querySelectorAll<HTMLElement>(`kbd.keycap[data-key="${CSS.escape(key)}"]`)) {
		cap.dataset.pressed = '';
		setTimeout(() => delete cap.dataset.pressed, FLASH_MS);
	}
}

/**
 * Listen for page shortcuts on the window. Plain keys are ignored while the
 * person types or a dialog is open; `mod+` keys always fire, and Esc leaves a
 * text field so the keyboard flow can carry on. Returns the cleanup.
 */
export function listenKeys(map: () => KeyMap): () => void {
	function onKey(event: KeyboardEvent): void {
		if (event.defaultPrevented || event.isComposing || event.altKey) return;

		const key = name(event);
		const modified = key.startsWith('mod+');

		if (event.key === 'Escape' && typing(event.target)) {
			(event.target as HTMLElement).blur();

			return;
		}

		if (!modified && (typing(event.target) || overlayOpen())) return;

		const handler = map()[key];

		if (!handler) return;

		event.preventDefault();
		flashKey(key);
		handler(event);
	}

	window.addEventListener('keydown', onKey);

	return () => window.removeEventListener('keydown', onKey);
}
