/** The longest run of backticks in the text, so a fence or span can be made longer than any of them. */
function longestBacktickRun(text: string): number {
	const runs = text.match(/`+/g) ?? [];

	return Math.max(0, ...runs.map((run) => run.length));
}

/** The text in a fenced block that its own backticks cannot close. */
export function fenceBlock(text: string, language: string): string {
	const fence = '`'.repeat(Math.max(3, longestBacktickRun(text) + 1));

	return `${fence}${language}\n${text.trimEnd()}\n${fence}`;
}

/** The text as an inline code span that its own backticks cannot close. */
export function inlineCode(text: string): string {
	const delimiter = '`'.repeat(longestBacktickRun(text) + 1);
	const padding = text.startsWith('`') || text.endsWith('`') ? ' ' : '';

	return `${delimiter}${padding}${text}${padding}${delimiter}`;
}
