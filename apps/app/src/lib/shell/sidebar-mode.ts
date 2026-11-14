'use client';

import { usePathname } from 'next/navigation';
import { useLayoutEffect, useRef, type RefObject } from 'react';

import { isSettingsPath } from './routes';

/** What the sidebar lists: the app's places, or Settings' sections. */
export type SidebarMode = 'app' | 'settings';

/** The two layers of one spot in the sidebar. */
interface SwapLayers {
	appRef: RefObject<HTMLDivElement | null>;
	settingsRef: RefObject<HTMLDivElement | null>;
}

/** The control that stands in a layer's place when focus has to land there (`[data-swap-focus]`), or its open row. */
const FOCUS_TARGET = '[aria-current="page"], [data-swap-focus]';

/** Where focus lands in a layer with neither, such as the app's on a page no row names. */
const FIRST_CONTROL = 'a[href], button:not(:disabled)';

/** Settings' pages swap the sidebar to their sections; every other page shows the app's places. */
export function useSidebarMode(): SidebarMode {
	return isSettingsPath(usePathname()) ? 'settings' : 'app';
}

/**
 * Refs for the two layers of one spot in the sidebar, and the move that
 * carries focus between them. The layer leaving turns inert, which would
 * drop keyboard focus inside it onto the page body; a keyboard user's focus
 * moves to the arriving layer's open row, the control that took its place, or
 * failing both its first control. A pointer user's focus is left alone, so no
 * ring shows where the mouse is not.
 */
export function useSwapFocus(mode: SidebarMode): SwapLayers {
	const appRef = useRef<HTMLDivElement>(null);
	const settingsRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const leaving = mode === 'settings' ? appRef.current : settingsRef.current;
		const arriving = mode === 'settings' ? settingsRef.current : appRef.current;
		const focused = document.activeElement;

		if (!arriving || !leaving?.contains(focused) || !focused?.matches(':focus-visible')) return;

		const target =
			arriving.querySelector<HTMLElement>(FOCUS_TARGET) ?? arriving.querySelector<HTMLElement>(FIRST_CONTROL);

		target?.focus();
	}, [mode]);

	return { appRef, settingsRef };
}
