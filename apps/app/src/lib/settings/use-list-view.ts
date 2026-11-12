'use client';

import { useCallback, useSyncExternalStore } from 'react';

import { mountedRows, type RowLayout } from './model-rows';

/** Rows mounted beyond each edge of the viewport, so a short scroll never shows a gap. */
const OVERSCAN = 240;

/**
 * The list's scroll position below its top padding `pad`, and its height,
 * read from the element itself. A scroll, a resize, or a `scroll` event
 * dispatched after a programmatic scroll re-renders the rows in the same frame.
 */
export function useListView(list: HTMLElement | null, pad: number): { top: number; height: number } {
	const subscribe = useCallback(
		(notify: () => void) => {
			if (!list) return () => {};

			const observer = new ResizeObserver(notify);

			observer.observe(list);
			list.addEventListener('scroll', notify, { passive: true });

			return () => {
				observer.disconnect();
				list.removeEventListener('scroll', notify);
			};
		},
		[list]
	);

	const top = useSyncExternalStore(subscribe, () => (list ? list.scrollTop : 0));
	const height = useSyncExternalStore(subscribe, () => (list ? list.clientHeight : 0));

	return { top: Math.max(0, top - pad), height };
}

/**
 * The row indexes to mount for a windowed list: those near the viewport
 * plus the selected row, which stays mounted however far the list scrolls
 * from it. Until the list is measured only the pinned row mounts, so the
 * palette lands on it first.
 */
export function useMountedRows(layout: RowLayout, list: HTMLElement | null, selected: string | null): number[] {
	const view = useListView(list, layout.pad);
	const pinned = selected === null ? [] : [layout.index.get(selected) ?? -1];

	return list ? mountedRows(layout, view.top, view.height, OVERSCAN, pinned) : pinned.filter((at) => at >= 0);
}
