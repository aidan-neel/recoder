import { pxToRem } from '@recoder/ui/px-to-rem';

/** Tailwind first, then px to rem so the UI scales with the root font size on large screens. */
export default {
	plugins: ['@tailwindcss/postcss', pxToRem]
};
