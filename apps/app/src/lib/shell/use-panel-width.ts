'use client';

import { useSyncExternalStore } from 'react';

import { readStored, writeStored } from './browser-storage';
import { PANEL_WIDTHS, parseStoredWidth, widthToRem, type PanelId, type PanelWidthSpec } from './panel-width';

/** A panel's width as one external store: the live value, and the two ways to change it. */
interface PanelWidthStore {
	spec: PanelWidthSpec;
	subscribe: (notify: () => void) => () => void;
	read: () => number;
	readOnServer: () => number;
	setLive: (width: number) => void;
	save: (width: number) => void;
}

/**
 * Holds one panel's width. A live change sets the CSS variable on `<html>`
 * directly, so the layout follows the pointer without rendering the page; only
 * the handle that reads the value renders. Saving writes it to this browser.
 */
function createPanelWidthStore(spec: PanelWidthSpec): PanelWidthStore {
	const listeners = new Set<() => void>();
	let width: number | null = null;

	function read(): number {
		width ??= parseStoredWidth(readStored(spec.key), spec);

		return width;
	}

	return {
		spec,
		read,
		readOnServer: () => spec.fallback,
		subscribe(notify) {
			listeners.add(notify);

			return () => listeners.delete(notify);
		},
		setLive(next) {
			width = next;
			document.documentElement.style.setProperty(spec.cssVar, widthToRem(next));
			listeners.forEach((notify) => notify());
		},
		save: (next) => writeStored(spec.key, String(next))
	};
}

const STORES: Record<PanelId, PanelWidthStore> = {
	sidebar: createPanelWidthStore(PANEL_WIDTHS.sidebar),
	changes: createPanelWidthStore(PANEL_WIDTHS.changes)
};

/** A panel's saved width, how to move it live, and how to save where it settled. */
export function usePanelWidth(panel: PanelId) {
	const store = STORES[panel];
	const width = useSyncExternalStore(store.subscribe, store.read, store.readOnServer);

	return { width, spec: store.spec, resize: store.setLive, commit: store.save };
}
