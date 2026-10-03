import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { pxToRem } from '../web/px-to-rem';

const webSrc = fileURLToPath(new URL('../web/src/', import.meta.url));
const webLib = fileURLToPath(new URL('../web/src/lib', import.meta.url));
const siteLib = fileURLToPath(new URL('./src/lib', import.meta.url));

/**
 * Components imported from apps/web keep resolving their own `$lib` imports
 * against apps/web, not this site. Handles both the raw specifier and the one
 * SvelteKit's alias has already rewritten to this site's lib.
 */
function webLibForWebFiles(): Plugin {
	return {
		name: 'recoder-web-lib',
		enforce: 'pre',
		resolveId(source, importer, options) {
			if (!importer?.startsWith(webSrc)) return null;

			let rest: string | null = null;

			if (source === '$lib' || source.startsWith('$lib/')) rest = source.slice(4);
			else if (source.startsWith(siteLib)) rest = source.slice(siteLib.length);
			if (rest === null) return null;

			return this.resolve(webLib + rest, importer, { ...options, skipSelf: true });
		}
	};
}

export default defineConfig({
	css: { postcss: { plugins: [pxToRem] } },
	plugins: [webLibForWebFiles(), tailwindcss(), sveltekit()],
	server: { fs: { allow: ['../web/src'] } }
});
