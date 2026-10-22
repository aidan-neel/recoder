import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/**
 * The curated grammars: what pull requests and model replies most often hold.
 * Anything else renders as escaped plain text.
 */
const GRAMMARS = {
	typescript,
	javascript,
	python,
	go,
	rust,
	java,
	kotlin,
	swift,
	ruby,
	php,
	c,
	cpp,
	csharp,
	bash,
	json,
	yaml,
	ini,
	css,
	scss,
	markdown,
	sql,
	diff,
	graphql,
	dockerfile,
	makefile,
	xml
};

/**
 * Fence names and file extensions mapped onto the registered grammars. JSX
 * and TSX read best through TypeScript; TOML through INI; HTML, SVG and
 * component files through XML (which hands `<script>` and `<style>` on).
 */
const ALIASES: Record<string, keyof typeof GRAMMARS> = {
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
	golang: 'go',
	rs: 'rust',
	kt: 'kotlin',
	kts: 'kotlin',
	rb: 'ruby',
	rake: 'ruby',
	gemspec: 'ruby',
	h: 'c',
	cc: 'cpp',
	cxx: 'cpp',
	hpp: 'cpp',
	hh: 'cpp',
	'c++': 'cpp',
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
	patch: 'diff',
	gql: 'graphql',
	docker: 'dockerfile',
	mk: 'makefile',
	make: 'makefile',
	html: 'xml',
	htm: 'xml',
	xhtml: 'xml',
	svg: 'xml',
	plist: 'xml',
	vue: 'xml',
	svelte: 'xml'
};

/** File names that carry their language without an extension. */
const FILE_NAMES: Record<string, keyof typeof GRAMMARS> = {
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

/** Highlighted output kept for repeat renders, oldest dropped first. */
const CACHE_SIZE = 200;

const cache = new Map<string, string>();

let registered = false;

/** Registers the grammars on first use, so importing the kit costs nothing until code is shown. */
function register(): void {
	if (registered) return;

	registered = true;

	for (const [name, grammar] of Object.entries(GRAMMARS)) hljs.registerLanguage(name, grammar);
}

/** A registered grammar name for a fence name, extension or grammar alias, or null. */
function resolve(lang: string | null): string | null {
	if (!lang) return null;

	register();

	const key = lang.trim().toLowerCase();
	const name = ALIASES[key] ?? key;

	return hljs.getLanguage(name) ? name : null;
}

/** Escapes text for use as HTML content. */
function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Remembers a result, dropping the oldest entry once the cache is full. */
function remember(key: string, html: string): string {
	if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value ?? '');

	cache.set(key, html);

	return html;
}

/**
 * Highlights code as HTML with `hljs-*` token classes (kit-content.css colors
 * them through the `--syn-*` tokens). An unknown or missing language returns
 * the code escaped as plain text. Results are cached.
 */
export function highlightCode(code: string, lang: string | null): string {
	const name = resolve(lang);

	if (!name) return escapeHtml(code);

	const key = `${name}\n${code}`;

	return cache.get(key) ?? remember(key, hljs.highlight(code, { language: name, ignoreIllegals: true }).value);
}

/** The language `highlightCode` should use for a file path, from its name or extension; null when unknown. */
export function langForPath(path: string): string | null {
	const name = (path.split('/').at(-1) ?? '').toLowerCase();

	if (FILE_NAMES[name]) return FILE_NAMES[name];

	if (name.startsWith('dockerfile.') || name.endsWith('.dockerfile')) return 'dockerfile';

	const dot = name.lastIndexOf('.');

	return dot === -1 ? null : resolve(name.slice(dot + 1));
}
