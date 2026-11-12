/** The loaded highlighter module: `highlightCode`, `highlightDiff` and the grammar loader. */
export type Highlighter = typeof import('./highlighter');

/** The highlighter once it has loaded; it stays loaded for the life of the page. */
let loaded: Highlighter | null = null;

/** The highlighter's import, shared by every caller until it settles. */
let loading: Promise<Highlighter | null> | null = null;

/** Code views waiting for a grammar to load. */
const listeners = new Set<() => void>();

/** Escapes text for use as HTML content: what code shows as before, or without, highlighting. */
export function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Loads highlight.js core once, in its own chunk, without any grammar. A
 * failed load (a lost chunk) resolves null and is tried again on the next
 * call; code stays plain meanwhile.
 */
function loadHighlighter(): Promise<Highlighter | null> {
	loading ??= import('./highlighter').then(
		(module) => {
			loaded = module;

			return module;
		},
		() => {
			loading = null;

			return null;
		}
	);

	return loading;
}

/**
 * Loads the highlighter and the grammars for `langs` (`langForPath`), each
 * grammar in its own chunk, and tells waiting code views as each one lands.
 * Call it before code shows, such as when a page that will show code starts
 * fetching it, so that code paints colored; with no languages it loads only
 * the core. An unknown language loads no grammar. Resolves once every load
 * has landed or failed, and never rejects: a failed load leaves that code
 * plain and is tried again on the next call.
 */
export async function preloadHighlighter(langs: readonly (string | null)[] = []): Promise<void> {
	const highlighter = await loadHighlighter();

	if (!highlighter) return;

	await Promise.all(
		langs.map(async (lang) => {
			if (highlighter.hasGrammar(lang) || !(await highlighter.loadGrammar(lang))) return;

			for (const listener of listeners) listener();
		})
	);
}

/** Listens for grammars to load. Returns the cleanup. */
export function onGrammarLoad(listener: () => void): () => void {
	listeners.add(listener);

	return () => listeners.delete(listener);
}

/** The highlighter once it can color code in `lang`, else null. */
export function highlighterFor(lang: string | null): Highlighter | null {
	return loaded?.hasGrammar(lang) ? loaded : null;
}

/**
 * Highlighted HTML for code when its grammar has loaded, else the code
 * escaped. For server components, which await `preloadHighlighter` first and
 * cannot use `useHighlighter`. This module holds no hooks, so server
 * components can import it.
 */
export function highlightNow(code: string, lang: string | null): string {
	return loaded ? loaded.highlightCode(code, lang) : escapeHtml(code);
}
