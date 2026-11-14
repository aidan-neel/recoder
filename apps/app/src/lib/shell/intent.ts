'use client';

import { useEffect, useMemo, useRef } from 'react';

/** How long the pointer or focus must rest on the element before `intent` runs; fly-overs and quick key steps cost nothing. */
const INTENT_MS = 90;

export interface IntentHandlers {
	onPointerEnter: () => void;
	onPointerLeave: () => void;
	onFocus: () => void;
	onBlur: () => void;
}

/**
 * Handlers that run `intent` once the pointer or focus has rested on the
 * element for a beat: hover intent for prefetching what a click would open.
 * Leaving or blurring the element first cancels it.
 */
export function useIntent(intent: () => void): IntentHandlers {
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

	/** An intent left pending when the row unmounts never fires. */
	useEffect(() => () => clearTimeout(timer.current), []);

	return useMemo<IntentHandlers>(() => {
		const cancel = () => {
			clearTimeout(timer.current);
			timer.current = undefined;
		};

		const rest = () => {
			cancel();
			timer.current = setTimeout(intent, INTENT_MS);
		};

		return { onPointerEnter: rest, onPointerLeave: cancel, onFocus: rest, onBlur: cancel };
	}, [intent]);
}
