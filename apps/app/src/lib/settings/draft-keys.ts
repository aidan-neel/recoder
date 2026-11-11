import type { KeyboardEvent } from 'react';

/**
 * Keys for a field that saves its draft: Enter commits it, Escape puts the
 * saved value back. Neither does anything while the field shows the saved value.
 */
export function draftKeys(
	event: KeyboardEvent<HTMLInputElement>,
	draft: string | null,
	commit: (text: string) => void,
	revert: () => void
): void {
	if (draft === null) return;

	if (event.key === 'Enter') {
		event.preventDefault();
		commit(draft);
	}

	if (event.key === 'Escape') {
		event.preventDefault();
		revert();
	}
}
