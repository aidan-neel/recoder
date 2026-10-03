import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { pxToRem } from './px-to-rem';

export default defineConfig({
	css: { postcss: { plugins: [pxToRem] } },
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				/** Runes mode for project files; libraries in node_modules keep their own mode. */
				runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
			},

			adapter: adapter()
		})
	]
});
