import { generateManifest } from 'material-icon-theme';

/**
 * File and folder icons from the Material Icon Theme (the VS Code extension's
 * package). Each SVG is its own asset URL, so the browser only fetches the
 * icons the tree actually shows.
 */
const urls = import.meta.glob('/node_modules/material-icon-theme/icons/*.svg', {
	eager: true,
	query: '?url&no-inline',
	import: 'default'
}) as Record<string, string>;

type Manifest = ReturnType<typeof generateManifest>;
let manifest: Manifest | null = null;
const cache = new Map<string, string>();

/** Extensions the theme maps by VS Code language id rather than by extension. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
	ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact', mjs: 'javascript', cjs: 'javascript',
	json: 'json', jsonc: 'jsonc', md: 'markdown', css: 'css', scss: 'scss', html: 'html', yml: 'yaml', yaml: 'yaml',
	py: 'python', go: 'go', rs: 'rust', rb: 'ruby', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c',
	cpp: 'cpp', cs: 'csharp', php: 'php', sh: 'shellscript', bash: 'shellscript', sql: 'sql', xml: 'xml', toml: 'toml'
};

function load(): Manifest {
	manifest ??= generateManifest();
	return manifest;
}

function urlFor(id: string | undefined): string | undefined {
	if (!id) return undefined;
	const path = load().iconDefinitions?.[id]?.iconPath;
	const file = path?.split('/').at(-1);
	return file ? urls[`/node_modules/material-icon-theme/icons/${file}`] : undefined;
}

/** Icon for a file name, matched like VS Code: exact name, then longest extension ("test.ts" before "ts"). */
export function fileIconUrl(name: string): string {
	const key = `f:${name}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const m = load();
	const lower = name.toLowerCase();
	let id = m.fileNames?.[lower];
	const parts = lower.split('.');
	for (let i = 1; !id && i < parts.length; i++) {
		const ext = parts.slice(i).join('.');
		id = m.fileExtensions?.[ext] ?? (i === parts.length - 1 ? m.languageIds?.[LANGUAGE_BY_EXTENSION[ext] ?? ''] : undefined);
	}
	const url = urlFor(id) ?? urlFor(m.file) ?? '';
	cache.set(key, url);
	return url;
}

/** Icon for a folder name, open or closed (e.g. `src`, `components`, `tests`). */
export function folderIconUrl(name: string, open: boolean): string {
	const key = `${open ? 'o' : 'c'}:${name}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const m = load();
	const lower = name.toLowerCase();
	const id = open ? m.folderNamesExpanded?.[lower] ?? m.folderExpanded : m.folderNames?.[lower] ?? m.folder;
	const url = urlFor(id) ?? '';
	cache.set(key, url);
	return url;
}
