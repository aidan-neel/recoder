import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

/**
 * Converts px lengths in all CSS (tokens, Tailwind arbitrary values, Sivir) to
 * rem so the whole UI scales with the root font size, which app.css raises on
 * large monitors. Hairlines under 2px stay in px; media queries are untouched.
 */
const pxToRem = {
	postcssPlugin: 'recoder-px-to-rem',
	Declaration(decl: { value: string }) {
		if (!decl.value.includes('px') || decl.value.includes('url(')) return;
		decl.value = decl.value.replace(/(-?\d*\.?\d+)px\b/g, (match, n: string) =>
			Math.abs(Number(n)) < 2 ? match : `${Number(n) / 16}rem`
		);
	}
};

export default defineConfig({
	css: { postcss: { plugins: [pxToRem] } },
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
			// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter()
		})
	]
});
