import { fileURLToPath } from 'node:url';
import type { Plugin, PluginOption, UserConfig } from 'vite';
import { pxToRem } from './px-to-rem';

const webSrc = fileURLToPath(new URL('./src/', import.meta.url));
const webLib = fileURLToPath(new URL('./src/lib', import.meta.url));

/**
 * For apps that render this app's components through `$web` (the site and
 * the bench devtool). Components imported from apps/web keep resolving their
 * own `$lib` imports against apps/web, not the host app. Handles both the raw
 * specifier and the one SvelteKit's alias has already rewritten to the host
 * app's lib.
 */
function webLibForWebFiles(hostLib: string): Plugin {
	return {
		name: 'recoder-web-lib',
		enforce: 'pre',
		resolveId(source, importer, options) {
			if (!importer?.startsWith(webSrc)) return null;

			let rest: string | null = null;

			if (source === '$lib' || source.startsWith('$lib/')) rest = source.slice(4);
			else if (source.startsWith(hostLib)) rest = source.slice(hostLib.length);
			if (rest === null) return null;

			return this.resolve(webLib + rest, importer, { ...options, skipSelf: true });
		}
	};
}

/**
 * The Vite config of an app that embeds this one: rem scaling, this app's
 * `$lib` for its own files, and dev access to its source. The host passes its
 * Tailwind and SvelteKit plugins so they come from its own install.
 */
export function embedWebVite(configUrl: string, plugins: PluginOption[], allow: string[] = []): UserConfig {
	return {
		css: { postcss: { plugins: [pxToRem] } },
		plugins: [webLibForWebFiles(fileURLToPath(new URL('./src/lib', configUrl))), ...plugins],
		server: { fs: { allow: ['../web/src', ...allow] } }
	};
}
