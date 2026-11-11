/**
 * The PostCSS step every Recoder app runs after Tailwind: it converts px
 * lengths in all CSS (tokens, Tailwind arbitrary values, Sivir in apps/web,
 * this kit in apps/app and apps/site) to rem, so the whole UI scales with the
 * root font size each app raises on large monitors. Hairlines under 2px stay
 * in px; media queries are untouched.
 */

/**
 * Parts whose geometry JS sets in px, so their CSS must stay px to line up:
 * the switch's thumb offset and width, in Sivir and in this kit alike.
 */
const PX_SELECTORS = ["[data-ui='switch']"];

/**
 * A px length, read as one whole number: an exponent counts as part of it,
 * and digits inside a longer token are skipped. Tailwind writes
 * `rounded-full` as `3.40282e38px`; matching only its `38px` tail once turned
 * that into a 340px and a 6px radius, a leaf instead of a pill.
 */
const PX_LENGTH = /(?<![\w.-])(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)px\b/gi;

export const pxToRem = {
	postcssPlugin: 'recoder-px-to-rem',
	Declaration(decl: { value: string; parent?: { type: string; selector?: string } }) {
		if (!decl.value.includes('px') || decl.value.includes('url(')) return;
		if (PX_SELECTORS.some((selector) => decl.parent?.selector?.includes(selector))) return;

		decl.value = decl.value.replace(PX_LENGTH, (match, n: string) =>
			Math.abs(Number(n)) < 2 ? match : `${Number(n) / 16}rem`
		);
	}
};
