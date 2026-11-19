import { create } from 'zustand';

import { syncChrome } from '../shell/theme';
import {
	PALETTE,
	readChoice,
	saveChoice,
	SIDEBAR_ROWS,
	TYPEFACE,
	type PaletteId,
	type SidebarRowsId,
	type TypefaceId
} from './choices';

interface AppearanceState {
	palette: PaletteId;
	typeface: TypefaceId;
	sidebarRows: SidebarRowsId;
	pickPalette: (palette: PaletteId) => void;
	pickTypeface: (typeface: TypefaceId) => void;
	pickSidebarRows: (rows: SidebarRowsId) => void;
}

/**
 * The palette, typeface and sidebar rows on screen. The head script already set
 * them on <html> before first paint, so the store only reads them back and saves new picks.
 */
export const useAppearanceStore = create<AppearanceState>((setState) => ({
	palette: typeof window === 'undefined' ? PALETTE.fallback : readChoice(PALETTE),
	typeface: typeof window === 'undefined' ? TYPEFACE.fallback : readChoice(TYPEFACE),
	sidebarRows: typeof window === 'undefined' ? SIDEBAR_ROWS.fallback : readChoice(SIDEBAR_ROWS),
	pickPalette(palette) {
		saveChoice(PALETTE, palette);
		syncChrome();
		setState({ palette });
	},
	pickTypeface(typeface) {
		saveChoice(TYPEFACE, typeface);
		setState({ typeface });
	},
	pickSidebarRows(sidebarRows) {
		saveChoice(SIDEBAR_ROWS, sidebarRows);
		setState({ sidebarRows });
	}
}));
