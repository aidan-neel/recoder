import { useLayoutEffect, useRef, type RefObject } from 'react';
import { create } from 'zustand';

interface AskFocusStore {
	/** Goes up by one on every request, so the panel sees each one, even a repeat. */
	nonce: number;
}

/** The pending requests for the ask panel to put focus in its composer. */
const useAskFocus = create<AskFocusStore>(() => ({ nonce: 0 }));

/**
 * Asks the ask panel to put focus in its message field. Opening the column
 * already does this; call it when the column may be open already, as the
 * palette's Ask Orchestrator does, so focus still lands in the composer.
 */
export function requestAskFocus(): void {
	useAskFocus.setState((state) => ({ nonce: state.nonce + 1 }));
}

/**
 * Puts focus in the panel's message field when it takes text, else on the
 * panel itself, so Escape still closes the column. A control that goes away
 * when pressed (Stop, Try again, Discard) calls it so focus stays in the panel.
 */
export function focusComposer(panel: Element | null): void {
	const target = panel?.querySelector<HTMLElement>('textarea:not(:disabled)') ?? panel;

	if (target instanceof HTMLElement) target.focus({ preventScroll: true });
}

/**
 * Focuses the panel's composer on every request made while it is mounted.
 * It runs during layout, so a palette closing in the same commit leaves
 * focus where this puts it.
 */
export function useAskFocusRequests(panel: RefObject<HTMLElement | null>): void {
	const nonce = useAskFocus((state) => state.nonce);
	const seen = useRef(nonce);

	useLayoutEffect(() => {
		if (nonce === seen.current) return;

		seen.current = nonce;
		focusComposer(panel.current);
	}, [nonce, panel]);
}
