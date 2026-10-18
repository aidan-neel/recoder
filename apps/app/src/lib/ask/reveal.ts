/** The slowest reveal, in characters a second. */
const BASE_RATE = 45;

/** How much faster the reveal runs per character it is behind, so it trails the model by about a third of a second. */
const CATCH_UP = 3;

/** A word end this close past the step is where the step lands instead. */
const WORD_SLACK = 6;

/** The longest inline code span revealed in one step; a longer one types out like prose. */
const CODE_SPAN_MAX = 120;

/** A fenced code block, closed or still streaming. */
const FENCE = /```[\s\S]*?(?:```|$)/g;

/**
 * Where an inline code span opens in the text shown so far, or -1 when every
 * span is closed. Fenced blocks are skipped, and a span cannot cross a blank line.
 */
function openTick(shown: string): number {
	const prose = shown.replace(FENCE, (block) =>
		block.endsWith('```') && block.length > 3 ? ' '.repeat(block.length) : '\0'
	);

	if (prose.includes('\0')) return -1;

	const paragraph = prose.lastIndexOf('\n\n') + 1;
	const ticks = [...prose.slice(paragraph).matchAll(/`/g)];

	return ticks.length % 2 ? paragraph + (ticks.at(-1)?.index ?? 0) : -1;
}

/**
 * How much of the text to show after a frame of `ms`, given `shown`
 * characters already out. It lands on a word end when one is close, and
 * shows an inline code span whole once its closing backtick has arrived, so
 * a lone backtick never sits on screen while the span types out.
 */
export function revealEnd(text: string, shown: number, ms: number): number {
	let end = shown + Math.max(1, Math.round((ms / 1000) * Math.max(BASE_RATE, (text.length - shown) * CATCH_UP)));
	const space = text.indexOf(' ', end);

	if (space > 0 && space - end < WORD_SLACK) end = space + 1;

	end = Math.min(text.length, end);

	const open = openTick(text.slice(0, end));
	const close = open < 0 ? -1 : text.indexOf('`', end);

	return close > 0 && close - open <= CODE_SPAN_MAX ? close + 1 : end;
}
