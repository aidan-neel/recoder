/**
 * The type-check side of `webLibForWebFiles` in embed-web-vite.ts. The app's components import
 * `$lib/...`, which TypeScript can't scope by importer, so fall back to
 * apps/web for modules the host app doesn't define.
 *
 * @param {{ compilerOptions: { paths: Record<string, string[]> } }} tsconfig
 */
function includeWebLib(tsconfig) {
	tsconfig.compilerOptions.paths['$lib/*'].push('../../web/src/lib/*');
}

/**
 * The svelte.config.js of an app that embeds this one: runes in its own code,
 * `$web` pointing here, and the type-check fallback above.
 *
 * @param {Omit<import('@sveltejs/kit').KitConfig, 'alias' | 'typescript'> & { alias?: Record<string, string> }} kit
 * @returns {import('@sveltejs/kit').Config}
 */
export function embedWebConfig({ alias = {}, ...kit }) {
	return {
		compilerOptions: {
			runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
		},
		kit: {
			...kit,
			alias: { $web: '../web/src/lib', ...alias },
			typescript: { config: includeWebLib }
		}
	};
}
