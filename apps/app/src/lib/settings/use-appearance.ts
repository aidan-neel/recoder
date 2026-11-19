'use client';

import type { ThemeChoice } from '@recoder/shared';

import { useAppearanceStore } from '../appearance/appearance-store';
import type { PaletteId, SidebarRowsId, TypefaceId } from '../appearance/choices';
import { useTheme } from '../shell/theme';

/** Everything the Appearance section shows and does. Each pick lives in this browser, so it works without the review server. */
export interface AppearanceView {
	/** The theme choice on screen: system, light or dark. */
	theme: ThemeChoice;
	pickTheme: (theme: ThemeChoice) => void;
	palette: PaletteId;
	pickPalette: (palette: PaletteId) => void;
	typeface: TypefaceId;
	pickTypeface: (typeface: TypefaceId) => void;
	sidebarRows: SidebarRowsId;
	pickSidebarRows: (rows: SidebarRowsId) => void;
}

/** Settings → Appearance: the theme, the palette, the typeface and the sidebar's rows. */
export function useAppearance(): AppearanceView {
	const theme = useTheme((state) => state.choice);
	const palette = useAppearanceStore((state) => state.palette);
	const typeface = useAppearanceStore((state) => state.typeface);
	const sidebarRows = useAppearanceStore((state) => state.sidebarRows);
	const { pickPalette, pickTypeface, pickSidebarRows } = useAppearanceStore.getState();

	return {
		theme,
		pickTheme: (next) => useTheme.getState().set(next),
		palette,
		pickPalette,
		typeface,
		pickTypeface,
		sidebarRows,
		pickSidebarRows
	};
}
