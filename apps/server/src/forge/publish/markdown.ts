/**
 * Model prose with every `@name` broken by a zero-width space, so a review
 * never pings anyone or summons a bot (Recoder included) by quoting a handle.
 */
export function quiet(text: string): string {
	return text.replace(/(^|[^\w`])@(?=[\w-])/g, '$1@​');
}

/** Text as a markdown quote, every line marked, so a quoted line cannot end the quote and start markup of its own. */
export function quoteBlock(text: string): string {
	return text
		.trim()
		.split('\n')
		.map((line) => `> ${quiet(line)}`)
		.join('\n');
}

/** Untrusted text cut to `max` characters, marked when cut, so a long command output keeps the comment readable. */
export function clip(text: string, max: number): string {
	const trimmed = text.trim();

	return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}\n…`;
}
