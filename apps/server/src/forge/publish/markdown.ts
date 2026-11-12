/**
 * Model prose with every `@name` broken by a zero-width space, so a review
 * never pings anyone or summons a bot (Recoder included) by quoting a handle.
 */
export function quiet(text: string): string {
	return text.replace(/(^|[^\w`])@(?=[\w-])/g, '$1@​');
}

/**
 * Untrusted prose that renders as plain text: mentions broken as `quiet`
 * does, and every run of three or more backticks or tildes split by
 * zero-width spaces, so the text can open no code fence. A fenced
 * `suggestion` block in a model's or a run's words would otherwise show as a
 * change the reader can apply; only a checked patch may make one.
 */
export function inertProse(text: string): string {
	return quiet(text).replace(/`{3,}|~{3,}/g, (run) => [...run].join('\u200B'));
}

/**
 * A finding's words as the model wrote them, with their code blocks kept:
 * mentions broken as `quiet` does, and a fenced `suggestion` block turned into
 * a plain code block. A forge offers a `suggestion` block as a change the
 * reader can apply with one click; only a checked patch may make one.
 */
export function findingProse(text: string): string {
	return quiet(text).replace(/^([ \t]*(?:`{3,}|~{3,})[ \t]*)suggestion\b[^\n]*/gim, '$1text');
}

/** Text as a markdown quote, every line marked, so a quoted line cannot end the quote and start markup of its own. */
export function quoteBlock(text: string): string {
	return text
		.trim()
		.split('\n')
		.map((line) => `> ${inertProse(line)}`)
		.join('\n');
}

/** Untrusted text cut to `max` characters, marked when cut, so a long command output keeps the comment readable. */
export function clip(text: string, max: number): string {
	const trimmed = text.trim();

	return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}\n…`;
}
