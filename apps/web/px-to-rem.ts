/**
 * Converts px lengths in all CSS (tokens, Tailwind arbitrary values, Sivir) to
 * rem so the whole UI scales with the root font size, which app.css raises on
 * large monitors. Hairlines under 2px stay in px; media queries are untouched.
 */
/** Parts Sivir sizes in px from JS (the switch thumb's offset and width); their CSS stays px so the two line up. */
const PX_SELECTORS = ["[data-ui='switch']"];

export const pxToRem = {
	postcssPlugin: 'recoder-px-to-rem',
	Declaration(decl: { value: string; parent?: { type: string; selector?: string } }) {
		if (!decl.value.includes('px') || decl.value.includes('url(')) return;
		if (PX_SELECTORS.some((selector) => decl.parent?.selector?.includes(selector))) return;

		decl.value = decl.value.replace(/(-?\d*\.?\d+)px\b/g, (match, n: string) =>
			Math.abs(Number(n)) < 2 ? match : `${Number(n) / 16}rem`
		);
	}
};
