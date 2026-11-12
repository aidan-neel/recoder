import { within, type FileDiff, type Review } from '@recoder/shared';
import { langForPath, preloadHighlighter, whenIdle } from '@recoder/ui';

import { surfaceOf } from './review-state';

/**
 * A first visit, and a full page load that paints a kept copy, wait this
 * long for the grammars of the code the first screen shows, so that code
 * paints colored; a slower grammar colors it in place. The overview shows no
 * code, so it never waits.
 */
const GRAMMAR_WAIT_MS = 150;

/** The rest of the diff's grammars load once the page is idle, or after this at the latest. */
const GRAMMAR_IDLE_MS = 2000;

/** The highlighter's languages for the files in a diff. */
function langsOf(files: readonly FileDiff[]): (string | null)[] {
	return [...new Set(files.map((file) => langForPath(file.path)))];
}

/**
 * The languages of the code the first screen shows: none on the overview,
 * else the file of the item a link names. A review the page cannot build its
 * items from shows no code; the load says why once it accepts it.
 */
export function firstLangs(review: Review, files: FileDiff[], link: string | null): string[] {
	if (!link) return [];

	try {
		const surface = surfaceOf({ review, files, records: {} });
		const item = [...(surface?.decisions ?? []), ...(surface?.receipts ?? [])].find((entry) => entry.id === link);
		const lang = langForPath(item?.file ?? link);

		return lang ? [lang] : [];
	} catch {
		return [];
	}
}

/** Gives grammars `langs` at most {@link GRAMMAR_WAIT_MS} to load, so the first screen's code paints colored. */
export async function grammarsFirst(langs: string[]): Promise<void> {
	if (langs.length > 0) await within(preloadHighlighter(langs), GRAMMAR_WAIT_MS, undefined);
}

/**
 * Loads a diff's grammars once the page is idle: for the review on screen,
 * so picking another file paints it colored, and for one read ahead, so its
 * page, which opens without a wait, paints its code colored too.
 */
export function grammarsWhenIdle(files: readonly FileDiff[]): void {
	whenIdle(() => void preloadHighlighter(langsOf(files)), GRAMMAR_IDLE_MS);
}
