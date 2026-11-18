/** A row of one of the composer's menus: a short name and what it is. */
export interface ComposerMenuItem {
	/** The word after the slash, with no spaces: `review`. */
	name: string;
	/** What it does or holds, in a few words. */
	description: string;
}

/** A command the composer's "/" menu offers: a short name, what it does, and the text a pick puts in the field. */
export interface ComposerCommand extends ComposerMenuItem {
	/** The text the field holds once the command is picked; the person can add to it before sending. */
	prompt: string;
}

/**
 * The rows that match a query, best first: names that start with it, then
 * names or descriptions that contain it. Each keeps its own order within its
 * rank, and an empty query matches every row. Names match without case.
 */
export function matchItems<Item extends ComposerMenuItem>(items: readonly Item[], query: string): Item[] {
	const term = query.toLowerCase();
	const starts = items.filter((item) => item.name.toLowerCase().startsWith(term));

	const contains = items.filter(
		(item) =>
			!item.name.toLowerCase().startsWith(term) &&
			(item.name.toLowerCase().includes(term) || item.description.toLowerCase().includes(term))
	);

	return [...starts, ...contains];
}
