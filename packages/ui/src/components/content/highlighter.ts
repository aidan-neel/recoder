import type { LanguageFn } from 'highlight.js';
import hljs from 'highlight.js/lib/core';

import { escapeHtml } from './highlight';
import { highlightLines, type SourceLine } from './highlight-lines';
import { resolveLang, type Grammar } from './languages';

/** A grammar module as `import()` hands it over. */
type GrammarModule = { default: LanguageFn };

/**
 * The highlighter: highlight.js core and a loader for each curated grammar.
 * Nothing imports this module statically; `highlight.ts` loads it when code
 * in a known language shows, or when a page that will show code preloads it.
 * Each grammar is its own chunk, fetched the first time code in it shows, so
 * a page downloads only the grammars its code uses.
 */
const GRAMMARS: Record<Grammar, () => Promise<GrammarModule>> = {
	typescript: () => import('highlight.js/lib/languages/typescript'),
	javascript: () => import('highlight.js/lib/languages/javascript'),
	python: () => import('highlight.js/lib/languages/python'),
	go: () => import('highlight.js/lib/languages/go'),
	rust: () => import('highlight.js/lib/languages/rust'),
	java: () => import('highlight.js/lib/languages/java'),
	kotlin: () => import('highlight.js/lib/languages/kotlin'),
	swift: () => import('highlight.js/lib/languages/swift'),
	ruby: () => import('highlight.js/lib/languages/ruby'),
	php: () => import('highlight.js/lib/languages/php'),
	c: () => import('highlight.js/lib/languages/c'),
	cpp: () => import('highlight.js/lib/languages/cpp'),
	csharp: () => import('highlight.js/lib/languages/csharp'),
	bash: () => import('highlight.js/lib/languages/bash'),
	json: () => import('highlight.js/lib/languages/json'),
	yaml: () => import('highlight.js/lib/languages/yaml'),
	ini: () => import('highlight.js/lib/languages/ini'),
	css: () => import('highlight.js/lib/languages/css'),
	scss: () => import('highlight.js/lib/languages/scss'),
	markdown: () => import('highlight.js/lib/languages/markdown'),
	sql: () => import('highlight.js/lib/languages/sql'),
	diff: () => import('highlight.js/lib/languages/diff'),
	graphql: () => import('highlight.js/lib/languages/graphql'),
	dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
	makefile: () => import('highlight.js/lib/languages/makefile'),
	xml: () => import('highlight.js/lib/languages/xml')
};

/**
 * The grammars each one hands part of its text to, as their `subLanguage`
 * says: XML's `<style>` goes to CSS, a TypeScript `html` template to XML.
 * They load and register with it, so a grammar colors the same text the same
 * way whichever grammars the page used first.
 */
const EMBEDS: Partial<Record<Grammar, readonly Grammar[]>> = {
	typescript: ['css', 'graphql', 'xml'],
	javascript: ['css', 'graphql', 'xml'],
	xml: ['css', 'javascript'],
	markdown: ['xml'],
	yaml: ['ruby'],
	dockerfile: ['bash']
};

/** `name` and every grammar it embeds, directly or through another, the embedded ones first. */
function withEmbeds(name: Grammar): Grammar[] {
	const found = new Set<Grammar>();

	const visit = (grammar: Grammar): void => {
		if (found.has(grammar)) return;

		found.add(grammar);
		EMBEDS[grammar]?.forEach(visit);
	};

	visit(name);
	found.delete(name);

	return [...found, name];
}

/** Grammars registered so far. A registered grammar already has its embedded ones. */
const registered = new Set<Grammar>();

/** Grammar loads in flight, shared by every caller until they settle. */
const loading = new Map<Grammar, Promise<boolean>>();

/** Registers grammars that have loaded, in order, skipping any already registered. */
function register(names: readonly Grammar[], modules: readonly GrammarModule[]): void {
	names.forEach((grammar, at) => {
		if (registered.has(grammar)) return;

		hljs.registerLanguage(grammar, modules[at].default);
		registered.add(grammar);
	});
}

/**
 * Fetches the grammar for `lang` and the grammars it embeds, then registers
 * them, the embedded ones first. Resolves true once code in `lang` colors;
 * false for an unknown language, or when a chunk failed to load, and the
 * next call tries again.
 */
export function loadGrammar(lang: string | null): Promise<boolean> {
	const name = resolveLang(lang);

	if (!name) return Promise.resolve(false);

	if (registered.has(name)) return Promise.resolve(true);

	const pending = loading.get(name);

	if (pending) return pending;

	const names = withEmbeds(name);

	const load = Promise.all(names.map((grammar) => GRAMMARS[grammar]()))
		.then(
			(modules) => {
				register(names, modules);

				return true;
			},
			() => false
		)
		.finally(() => loading.delete(name));

	loading.set(name, load);

	return load;
}

/** Whether code in `lang` colors now: its grammar has loaded. */
export function hasGrammar(lang: string | null): boolean {
	const name = resolveLang(lang);

	return name !== null && registered.has(name);
}

/** Highlighted output kept for repeat renders, oldest dropped first. */
const CACHE_SIZE = 200;

const cache = new Map<string, string>();

/** Remembers a result, dropping the oldest entry once the cache is full. */
function remember(key: string, html: string): string {
	if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value ?? '');

	cache.set(key, html);

	return html;
}

/**
 * Highlights code as HTML with `hljs-*` token classes (kit-content.css colors
 * them through the `--syn-*` tokens). An unknown language, or one whose
 * grammar has not loaded (`loadGrammar`), returns the code escaped as plain
 * text. Results are cached.
 */
export function highlightCode(code: string, lang: string | null): string {
	const name = resolveLang(lang);

	if (!name || !registered.has(name)) return escapeHtml(code);

	const key = `${name}\n${code}`;

	return cache.get(key) ?? remember(key, hljs.highlight(code, { language: name, ignoreIllegals: true }).value);
}

/**
 * Highlighted HTML for each diff line. The new side (context and added lines)
 * and the old side (context and removed lines) are highlighted separately, so
 * each reads as the file it came from.
 */
export function highlightDiff(lines: readonly SourceLine[], lang: string | null): string[] {
	return highlightLines(lines, lang, highlightCode);
}
