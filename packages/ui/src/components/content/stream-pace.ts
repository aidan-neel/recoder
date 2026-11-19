/**
 * How streamed text is let onto the page. Text arrives in bursts of any size; it is shown a word at a time at a
 * pace that keeps up with what has arrived, and never stops inside a word, a code span or a link, so the page
 * never draws half of one and then redraws it as something else.
 */

/** The slowest the text is let out, in characters a second, so a trickle still reads as a steady flow. */
const MIN_RATE = 48;

/** How far behind what has arrived the shown text may fall, in seconds: a bigger backlog lets out faster. */
const CATCH_UP_S = 0.32;

/** The characters a second to let out with `backlog` characters waiting. */
export function paceRate(backlog: number): number {
	return Math.max(MIN_RATE, backlog / CATCH_UP_S);
}

/** The ends of the words in `text` after `from`: each word with the space that follows it. */
function nextWordEnd(text: string, from: number): number | null {
	const word = /\S+\s*|\s+/y;

	word.lastIndex = from;

	const match = word.exec(text);

	return match ? from + match[0].length : null;
}

/** The start of the paragraph `at` sits in: just past the blank line before it. */
function paragraphStart(text: string, at: number): number {
	const blank = text.lastIndexOf('\n\n', at - 1);

	return blank < 0 ? 0 : blank + 2;
}

/** Whether `at` sits inside a fenced code block: an odd count of fence lines before it. */
function insideFence(text: string, at: number): boolean {
	const fences = text.slice(0, at).match(/^\s*(```|~~~)/gm);

	return (fences?.length ?? 0) % 2 === 1;
}

/** Where an inline code span opens before `end` in its paragraph and is not yet closed, or null. */
function openCodeSpan(text: string, end: number): number | null {
	const start = paragraphStart(text, end);
	const ticks = [...text.slice(start, end).matchAll(/`+/g)];

	if (ticks.length % 2 === 0) return null;

	return start + (ticks.at(-1)?.index ?? 0);
}

/** A link written so far as `[label](target)`, matched from its opening bracket. */
const WHOLE_LINK = /\[[^\]\n]*\]\([^)\s]*\)/y;

/** A link not yet whole: its label, perhaps its closing bracket, perhaps part of its target. */
const PARTIAL_LINK = /\[[^\]\n]*(?:\](?:\([^)\s]*)?)?$/y;

/** Where a link opens before `end` in its paragraph and is not yet whole, or null. */
function openLink(text: string, end: number): number | null {
	const open = text.lastIndexOf('[', end - 1);

	if (open < paragraphStart(text, end)) return null;

	WHOLE_LINK.lastIndex = open;

	const whole = WHOLE_LINK.exec(text);

	if (whole && open + whole[0].length <= end) return null;

	PARTIAL_LINK.lastIndex = open;

	return PARTIAL_LINK.test(text.slice(0, end)) ? open : null;
}

/**
 * Where to stop showing `text` near `end` so no code span or link is cut: past its end when it has arrived whole,
 * else before it opens. Inside a fenced block the code is shown as it comes.
 */
function markSafeEnd(text: string, end: number): number {
	if (insideFence(text, end)) return end;

	const code = openCodeSpan(text, end);

	if (code !== null) {
		const close = text.indexOf('`', end);

		return close < 0 ? code : close + 1;
	}

	const link = openLink(text, end);

	if (link === null) return end;

	WHOLE_LINK.lastIndex = link;

	const whole = WHOLE_LINK.exec(text);

	return whole ? link + whole[0].length : link;
}

/**
 * How much of `text` to show once `budget` more characters may go out after the first `shown`: whole words only,
 * at least one when the budget reaches it. The last word counts as whole only once the text is `done`, since more
 * of it may still be on its way. Returns the new length and the budget left, which is spent once the shown text
 * waits on text still to come, so a pause never banks a burst.
 */
export function revealStep(
	text: string,
	shown: number,
	budget: number,
	done: boolean
): { length: number; budget: number } {
	let length = shown;
	let left = budget;

	while (length < text.length) {
		const end = nextWordEnd(text, length);
		const partial = end === null || (end === text.length && !done && !/\s$/.test(text));
		const safe = partial ? length : Math.max(markSafeEnd(text, end), length);

		if (safe === length) return { length, budget: 0 };

		const cost = safe - length;

		if (cost > left) return { length, budget: left };

		length = safe;
		left -= cost;
	}

	return { length, budget: 0 };
}
