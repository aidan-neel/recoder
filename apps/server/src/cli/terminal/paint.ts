/** The SGR code that switches a style on, and the one that switches only that style off again. */
type StyleCodes = readonly [open: number, close: number];

/**
 * What each style means, as ANSI codes from the terminal's own 16 colors, so the user's theme decides the shades and
 * the text stays readable on a light or a dark background. `muted` is the faint attribute, not a gray.
 */
const STYLES = {
	strong: [1, 22],
	muted: [2, 22],
	error: [31, 39],
	warning: [33, 39],
	ok: [32, 39],
	info: [94, 39],
	code: [36, 39]
} as const satisfies Record<string, StyleCodes>;

type StyleName = keyof typeof STYLES;

/** Styles text by what it means. `strong` and `muted` share an off code, so one is never nested in the other. */
export type Paint = Readonly<Record<StyleName, (text: string) => string>>;

const ESCAPE = '\u001b[';

function styled([open, close]: StyleCodes): (text: string) => string {
	return (text) => (text === '' ? '' : `${ESCAPE}${open}m${text}${ESCAPE}${close}m`);
}

function unstyled(text: string): string {
	return text;
}

function paintWith(style: (codes: StyleCodes) => (text: string) => string): Paint {
	return {
		strong: style(STYLES.strong),
		muted: style(STYLES.muted),
		error: style(STYLES.error),
		warning: style(STYLES.warning),
		ok: style(STYLES.ok),
		info: style(STYLES.info),
		code: style(STYLES.code)
	};
}

const COLOR_PAINT = paintWith(styled);

const PLAIN_PAINT = paintWith(() => unstyled);

/** The styles for a stream that shows color, or the same names doing nothing for one that does not. */
export function paintFor(hasColor: boolean): Paint {
	return hasColor ? COLOR_PAINT : PLAIN_PAINT;
}
