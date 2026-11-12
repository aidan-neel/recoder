'use client';

import { useSyncExternalStore } from 'react';

import { highlighterFor, onGrammarLoad, preloadHighlighter, type Highlighter } from './highlight';
import { resolveLang } from './languages';

/** Nothing on the server, so a server render and its hydration both show plain code. */
function none(): null {
	return null;
}

/**
 * The highlighter for a code view in `lang`, or null until that grammar
 * loads. An unknown language (or none) never loads it. Once the grammar has
 * loaded it returns at once, so later code in it paints highlighted on its
 * first frame.
 *
 * The load starts during render, the way react-dom's `preload` does: it runs
 * once and is shared, and a view drawn ahead inside a hidden `Activity` runs
 * no effects, so this is what lets that code be colored before it shows.
 */
export function useHighlighter(lang: string | null): Highlighter | null {
	const highlighter = useSyncExternalStore(onGrammarLoad, () => highlighterFor(lang), none);

	if (!highlighter && typeof window !== 'undefined' && resolveLang(lang)) void preloadHighlighter([lang]);

	return highlighter;
}
