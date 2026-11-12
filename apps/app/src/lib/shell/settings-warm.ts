/** How long the pointer, focus or the palette's selection rests on a way to a settings page before its data is read ahead. */
export const INTENT_MS = 120;

/**
 * Starts or joins the reads settings page `path` paints from, and resolves
 * once they have answered (`prepareSection`). The code that reads them loads
 * on first use, so no page's first chunk carries the stores it needs beyond
 * its own. It resolves on any address, and never rejects: a lost chunk only
 * means the page loads its data after it shows.
 */
export function prepareSettings(path: string): Promise<void> {
	return import('../settings/settings-prepare').then(
		(module) => module.prepareSection(path),
		() => {}
	);
}
