/** What starts a terminal control sequence, such as a color. */
const SEQUENCE_START = '\u001b[';

/** A control sequence ends at its first letter. */
const SEQUENCE_END = /[A-Za-z]/;

const RESET = `${SEQUENCE_START}0m`;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The columns a string takes on a terminal: styles take none and a wide character takes two. */
export function visibleWidth(text: string): number {
	return Bun.stringWidth(text);
}

/** The text padded with spaces to `width` columns; text that is already wider is returned as it is. */
export function padEnd(text: string, width: number): string {
	return text + ' '.repeat(Math.max(0, width - visibleWidth(text)));
}

/** Like `padEnd`, with the spaces in front, for a column of numbers or times. */
export function padStart(text: string, width: number): string {
	return ' '.repeat(Math.max(0, width - visibleWidth(text))) + text;
}

/**
 * The text cut to at most `width` columns, ending in `ellipsis` when something was cut. Styles are kept and closed, so
 * a cut inside a colored span does not color what follows.
 */
export function truncate(text: string, width: number, ellipsis: string): string {
	if (visibleWidth(text) <= width) return text;

	const room = Math.max(0, width - visibleWidth(ellipsis));
	let kept = '';
	let used = 0;
	let index = 0;

	while (index < text.length) {
		const sequence = sequenceAt(text, index);

		if (sequence !== null) {
			kept += sequence;
			index += sequence.length;
			continue;
		}

		const [{ segment }] = graphemes.segment(text.slice(index));
		const segmentWidth = visibleWidth(segment);

		if (used + segmentWidth > room) break;

		kept += segment;
		used += segmentWidth;
		index += segment.length;
	}

	return `${kept}${kept.includes(SEQUENCE_START) ? RESET : ''}${ellipsis}`;
}

/** The control sequence that starts at `index`; null when the text there is something to show. */
function sequenceAt(text: string, index: number): string | null {
	if (!text.startsWith(SEQUENCE_START, index)) return null;

	const end = text.slice(index + SEQUENCE_START.length).search(SEQUENCE_END);

	return end === -1 ? text.slice(index) : text.slice(index, index + SEQUENCE_START.length + end + 1);
}

/**
 * Unstyled text as lines of at most `width` columns, broken at spaces and tabs only, so a no-break space keeps two
 * words on one line. A blank line stays a blank line, the spaces that indent a line are kept, and a word longer than
 * a line is broken where the line ends.
 */
export function wrapText(text: string, width: number): string[] {
	return text.split('\n').flatMap((line) => wrapLine(line.trimEnd(), Math.max(1, width)));
}

function wrapLine(line: string, width: number): string[] {
	if (visibleWidth(line) <= width) return [line];

	const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
	const lines: string[] = [];
	let current = indent;

	for (const word of line.slice(indent.length).split(/[ \t]+/)) {
		const candidate = current === indent ? `${indent}${word}` : `${current} ${word}`;

		if (visibleWidth(candidate) <= width) {
			current = candidate;
			continue;
		}

		if (current !== indent) lines.push(current);

		const pieces = breakWord(`${indent}${word}`, width);

		lines.push(...pieces.slice(0, -1));
		current = pieces[pieces.length - 1];
	}

	return current === indent ? lines : [...lines, current];
}

/** A word wider than the line, as pieces that each fit. */
function breakWord(word: string, width: number): string[] {
	const pieces: string[] = [];
	let piece = '';

	for (const { segment } of graphemes.segment(word)) {
		if (piece !== '' && visibleWidth(piece + segment) > width) {
			pieces.push(piece);
			piece = '';
		}

		piece += segment;
	}

	return [...pieces, piece];
}

/** Each line with `spaces` spaces in front; a blank line stays blank, so no line ends in spaces. */
export function indent(lines: readonly string[], spaces: number): string[] {
	const prefix = ' '.repeat(spaces);

	return lines.map((line) => (line === '' ? '' : `${prefix}${line}`));
}

/** `1 finding`, `2 findings`. */
export function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
