import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// Prerendered to plain HTML. No options: on Vercel, adapter-static only
		// switches to zero-config (Build Output API in .vercel/output) without them.
		adapter: adapter(),
		alias: {
			// The site renders the app's own components and styles, so the two never drift.
			$web: '../web/src/lib'
		},
		typescript: {
			// Type-check side of the resolver in vite.config.ts: the app's
			// components import `$lib/...`, which TypeScript can't scope by importer,
			// so fall back to apps/web for modules this site doesn't define.
			config(config) {
				config.compilerOptions.paths['$lib/*'].push('../../web/src/lib/*');
			}
		}
	}
};

export default config;
