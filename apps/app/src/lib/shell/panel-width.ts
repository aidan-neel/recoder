/** The two panels whose width a viewer can drag. */
export type PanelId = 'sidebar' | 'changes';

/** One resizable panel: where its width is saved, the CSS variable that carries it, and the widths it may take. */
export interface PanelWidthSpec {
	key: string;
	cssVar: string;
	min: number;
	max: number;
	fallback: number;
}

/**
 * Widths are CSS px at the base font scale. `fallback` repeats the CSS
 * default (`--sidebar-width` in tokens.css, `--changes-width` in changes.css).
 */
export const PANEL_WIDTHS: Record<PanelId, PanelWidthSpec> = {
	sidebar: { key: 'recoder.sidebar-width.v1', cssVar: '--sidebar-width', min: 200, max: 400, fallback: 248 },
	changes: { key: 'recoder.changes-width.v1', cssVar: '--changes-width', min: 200, max: 480, fallback: 264 }
};

/** The base font size every CSS px compiles against. */
export const REM_PX = 16;

/** The saved width held inside the panel's range; the fallback for no text or anything that is not a whole number. */
export function parseStoredWidth(text: string | null, { min, max, fallback }: PanelWidthSpec): number {
	if (text === null || !/^\d{1,4}$/.test(text)) return fallback;

	return Math.min(max, Math.max(min, Number(text)));
}

/** A width as the rem length the CSS variable holds, so it scales with the root font like every compiled px. */
export function widthToRem(width: number): string {
	return `${width / REM_PX}rem`;
}
