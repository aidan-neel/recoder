/**
 * The curated grammars: what pull requests and model replies most often hold.
 * Anything else renders as escaped plain text. The grammars themselves load
 * with the highlighter (`highlighter.ts`), which registers each one the first
 * time code in it shows; this list stays light, so naming a language costs
 * nothing.
 */
const GRAMMAR_NAMES = [
	'typescript',
	'javascript',
	'python',
	'go',
	'rust',
	'java',
	'kotlin',
	'swift',
	'ruby',
	'php',
	'c',
	'cpp',
	'csharp',
	'bash',
	'json',
	'yaml',
	'ini',
	'css',
	'scss',
	'markdown',
	'sql',
	'diff',
	'graphql',
	'dockerfile',
	'makefile',
	'xml'
] as const;

/** A grammar the highlighter registers. */
export type Grammar = (typeof GRAMMAR_NAMES)[number];

const GRAMMARS = new Set<string>(GRAMMAR_NAMES);

/**
 * Fence names and file extensions mapped onto the grammars, including every
 * alias the grammars declare themselves. JSX and TSX read best through
 * TypeScript; TOML through INI; HTML, SVG and component files through XML
 * (which hands `<script>` and `<style>` on).
 */
const ALIASES: Record<string, Grammar> = {
	ts: 'typescript',
	tsx: 'typescript',
	mts: 'typescript',
	cts: 'typescript',
	jsx: 'typescript',
	js: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	py: 'python',
	pyi: 'python',
	gyp: 'python',
	ipython: 'python',
	golang: 'go',
	rs: 'rust',
	jsp: 'java',
	kt: 'kotlin',
	kts: 'kotlin',
	ktm: 'kotlin',
	ktx: 'kotlin',
	rb: 'ruby',
	rake: 'ruby',
	gemspec: 'ruby',
	podspec: 'ruby',
	thor: 'ruby',
	irb: 'ruby',
	h: 'c',
	cc: 'cpp',
	cxx: 'cpp',
	hpp: 'cpp',
	hh: 'cpp',
	hxx: 'cpp',
	'c++': 'cpp',
	'h++': 'cpp',
	cs: 'csharp',
	'c#': 'csharp',
	sh: 'bash',
	zsh: 'bash',
	shell: 'bash',
	console: 'bash',
	jsonc: 'json',
	json5: 'json',
	yml: 'yaml',
	toml: 'ini',
	md: 'markdown',
	mdx: 'markdown',
	mkd: 'markdown',
	mkdown: 'markdown',
	patch: 'diff',
	gql: 'graphql',
	docker: 'dockerfile',
	mk: 'makefile',
	mak: 'makefile',
	make: 'makefile',
	html: 'xml',
	htm: 'xml',
	xhtml: 'xml',
	svg: 'xml',
	plist: 'xml',
	rss: 'xml',
	atom: 'xml',
	xjb: 'xml',
	xsd: 'xml',
	xsl: 'xml',
	wsf: 'xml',
	vue: 'xml',
	svelte: 'xml'
};

/** File names that carry their language without an extension. */
const FILE_NAMES: Record<string, Grammar> = {
	dockerfile: 'dockerfile',
	containerfile: 'dockerfile',
	makefile: 'makefile',
	gnumakefile: 'makefile',
	gemfile: 'ruby',
	rakefile: 'ruby',
	'.bashrc': 'bash',
	'.zshrc': 'bash',
	'.profile': 'bash'
};

/** The grammar for a fence name, extension or alias, or null when the highlighter has none. */
export function resolveLang(lang: string | null): Grammar | null {
	if (!lang) return null;

	const key = lang.trim().toLowerCase();
	const name = ALIASES[key] ?? key;

	return GRAMMARS.has(name) ? (name as Grammar) : null;
}

/** The language `CodeBlock` and `CodeLines` should use for a file path, from its name or extension; null when unknown. */
export function langForPath(path: string): string | null {
	const name = (path.split('/').at(-1) ?? '').toLowerCase();

	if (FILE_NAMES[name]) return FILE_NAMES[name];

	if (name.startsWith('dockerfile.') || name.endsWith('.dockerfile')) return 'dockerfile';

	const dot = name.lastIndexOf('.');

	return dot === -1 ? null : resolveLang(name.slice(dot + 1));
}
