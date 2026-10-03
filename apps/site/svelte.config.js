import adapter from '@sveltejs/adapter-vercel';

/**
 * Deployed to Vercel: pages are prerendered and /api/waitlist runs as a
 * function. The site renders the app's own components and styles through
 * `$web`, so the two never drift.
 *
 * @type {import('@sveltejs/kit').Config}
 */
const config = {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter(),
		alias: {
			$web: '../web/src/lib'
		},
		typescript: {
			config: includeWebLib
		}
	}
};

/**
 * The type-check side of the resolver in vite.config.ts. The app's components
 * import `$lib/...`, which TypeScript can't scope by importer, so fall back to
 * apps/web for modules this site doesn't define.
 *
 * @param {{ compilerOptions: { paths: Record<string, string[]> } }} tsconfig
 */
function includeWebLib(tsconfig) {
	tsconfig.compilerOptions.paths['$lib/*'].push('../../web/src/lib/*');
}

export default config;
