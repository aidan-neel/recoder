import { create } from 'zustand';

import { syncChrome } from '../shell/theme';
import { PALETTE, readChoice, saveChoice, TYPEFACE, type PaletteId, type TypefaceId } from './choices';

interface AppearanceState {
	palette: PaletteId;
	typeface: TypefaceId;
	pickPalette: (palette: PaletteId) => void;
	pickTypeface: (typeface: TypefaceId) => void;
}

/**
 * The palette and typeface on screen. The head script already set both on
 * <html> before first paint, so the store only reads them back and saves new picks.
 */
export const useAppearanceStore = create<AppearanceState>((setState) => ({
	palette: typeof window === 'undefined' ? PALETTE.fallback : readChoice(PALETTE),
	typeface: typeof window === 'undefined' ? TYPEFACE.fallback : readChoice(TYPEFACE),
	pickPalette(palette) {
		saveChoice(PALETTE, palette);
		syncChrome();
		setState({ palette });
	},
	pickTypeface(typeface) {
		saveChoice(TYPEFACE, typeface);
		setState({ typeface });
	}
}));
