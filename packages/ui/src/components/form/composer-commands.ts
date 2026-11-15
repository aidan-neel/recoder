/** A row of one of the composer's menus: a short name and what it is. */
export interface ComposerMenuItem {
	/** The word after the slash or the at sign, with no spaces: `review`. */
	name: string;
	/** What it does or holds, in a few words. */
	description: string;
}

/** A command the composer's "/" menu offers: a short name, what it does, and the text a pick puts in the field. */
export interface ComposerCommand extends ComposerMenuItem {
	/** The text the field holds once the command is picked; the person can add to it before sending. */
	prompt: string;
}

/** A slash at the very start, then one word and nothing else: the text while a command name is being typed. */
const TYPED_COMMAND = /^\/(\S*)$/;

/**
 * The command name being typed, lowercased: `re` for `/re`, an empty string
 * for a bare `/`. Null once the text is anything else, a space after the
 * name included, so a sentence that starts with a slash is sent as written.
 */
export function typedCommand(text: string): string | null {
	const match = TYPED_COMMAND.exec(text);

	return match ? (match[1] ?? '').toLowerCase() : null;
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

/**
 * The field's text once `command` is picked. A typed `/name` becomes the
 * command's prompt; text that is not a command name keeps its words, and the
 * prompt follows them on the same line.
 */
export function withCommand(text: string, command: ComposerCommand): string {
	const kept = typedCommand(text) === null ? text.trim() : '';

	return kept ? `${kept} ${command.prompt}` : command.prompt;
}
