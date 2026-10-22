import type { KeyboardEvent, KeyboardEventHandler } from 'react';

/**
 * Lets a held Enter press a button or row once. The browser clicks a focused
 * button (or follows a link) again on every repeated Enter, and the control
 * often keeps focus while what it acts on moves on (the next decision), so
 * one long press would act several times. Space already clicks once, on
 * release.
 */
export function pressOnce<T extends HTMLElement>(onKeyDown?: KeyboardEventHandler<T>): KeyboardEventHandler<T> {
	return (event: KeyboardEvent<T>) => {
		if (event.repeat && event.key === 'Enter') event.preventDefault();

		onKeyDown?.(event);
	};
}
