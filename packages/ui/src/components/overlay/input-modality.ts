/** Whether the person's last input was a key press rather than a pointer press. */
let keyboardLast = false;

/** How many mounted components need `keyboardLast` kept current. */
let watchers = 0;

function markKeyboard(): void {
	keyboardLast = true;
}

function markPointer(): void {
	keyboardLast = false;
}

/**
 * Follows the last input while any caller still watches, and returns the
 * stop function, so it can be an effect. `:focus-visible` cannot tell: a menu
 * opened by a click focuses itself from script, and Chrome then marks that
 * focus, and the trigger's when it comes back, as visible.
 */
export function watchInput(): () => void {
	if (watchers === 0) {
		document.addEventListener('keydown', markKeyboard, true);
		document.addEventListener('pointerdown', markPointer, true);
	}

	watchers += 1;

	return () => {
		watchers -= 1;

		if (watchers > 0) return;

		document.removeEventListener('keydown', markKeyboard, true);
		document.removeEventListener('pointerdown', markPointer, true);
	};
}

/** True when the last input, while watched, was a key press. */
export function isKeyboardLast(): boolean {
	return keyboardLast;
}
