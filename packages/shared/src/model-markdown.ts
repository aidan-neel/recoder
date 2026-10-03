/**
 * Repair the markdown small models write before it is rendered. They get the
 * idea right and the syntax wrong: escaped newlines copied out of a JSON
 * string, a whole reply wrapped in a code fence, headings we asked them not
 * to use, "•" bullets, a bold or backtick left open. Only unambiguous
 * mistakes are fixed; anything that could be intended is left alone.
 *
 * `complete: false` (still streaming) skips repairs that depend on the end of
 * the text, like closing an unbalanced marker, so the text only grows.
 */
export function normalizeModelMarkdown(text: string, opts: { complete?: boolean } = {}): string {
	const complete = opts.complete ?? true;
	let out = unwrapFence(text.replace(/\r\n?/g, '\n'), complete);

	out = unescapeNewlines(out);
	out = repairLines(out, complete);
	out = spaceListsFromParagraphs(out);
	out = out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '');

	if (complete) out = balanceMarkers(out);

	return out.trim();
}

/** Strip a ```markdown fence wrapped around the whole reply, which would otherwise render as one code block. */
function unwrapFence(text: string, complete: boolean): string {
	const wrapped = /^\s*```(?:markdown|md|text)?\n([\s\S]*?)\n?```\s*$/i.exec(text);

	if (wrapped) return wrapped[1];

	return complete ? text : text.replace(/^\s*```(?:markdown|md)\n/i, '');
}

/**
 * Turn a literal two-character "\n" back into a line break when the model escaped
 * for JSON twice. Only applies when the text has no real line breaks, so code
 * that mentions "\n" is left alone.
 */
function unescapeNewlines(text: string): string {
	if (text.includes('\n') || !/\\n/.test(text)) return text;

	return text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
}

/** Rewrite headings and unknown bullet glyphs on every line outside code fences. */
function repairLines(text: string, complete: boolean): string {
	const lines = text.split('\n');

	forEachProseLine(lines, (line, i) => {
		const demoted = demoteHeading(line, complete || i < lines.length - 1);

		return demoted === line ? normalizeBullet(line) : demoted;
	});

	return lines.join('\n');
}

/** Headings read as shouting in a chat reply: keep the words, bolded once the line is whole. */
function demoteHeading(line: string, whole: boolean): string {
	const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);

	if (!heading) return line;

	return whole && heading[1] ? `**${heading[1].replace(/\*\*/g, '')}**` : heading[1];
}

/** Bullet glyphs markdown doesn't know ("•", "▪"…) become "-". */
function normalizeBullet(line: string): string {
	return line.replace(/^(\s*)[•●▪‣◦·]\s+/, '$1- ');
}

/** Some renderers need a blank line between a paragraph line and the list that follows it. */
function spaceListsFromParagraphs(text: string): string {
	return text.replace(/^([^\n\-*\d\s|>`][^\n]*)\n(\s*(?:[-*+]|\d+[.)])\s)/gm, '$1\n\n$2');
}

/** Close a code fence left open, and drop a lone `**` or backtick that would swallow the rest of a line. */
function balanceMarkers(text: string): string {
	const lines = text.split('\n');

	const fence = forEachProseLine(lines, (line) => {
		if ((line.match(/`/g)?.length ?? 0) % 2 === 1) line = dropLast(line, '`');

		const outsideCode = line.replace(/`[^`]*`/g, '');

		return (outsideCode.match(/\*\*/g)?.length ?? 0) % 2 === 1 ? dropLast(line, '**') : line;
	});

	if (fence) lines.push(fence);

	return lines.join('\n');
}

/**
 * Replace each line outside code fences with `rewrite(line, index)`, in place.
 * Returns the fence still open after the last line, or null.
 */
function forEachProseLine(lines: string[], rewrite: (line: string, i: number) => string): string | null {
	let fence: string | null = null;

	for (let i = 0; i < lines.length; i++) {
		const next = fenceAfter(lines[i], fence);

		if (next !== undefined) {
			fence = next;
			continue;
		}

		if (!fence) lines[i] = rewrite(lines[i], i);
	}

	return fence;
}

/**
 * The open fence after `line`, or undefined when the line opens or closes
 * nothing. As in CommonMark, only a run of the same character, at least as
 * long, with nothing after it closes a fence, so a ```ts line inside a
 * ```` block is content.
 */
function fenceAfter(line: string, open: string | null): string | null | undefined {
	const match = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);

	if (!match) return undefined;

	const [, run, rest] = match;

	if (open === null) return run[0] === '`' && rest.includes('`') ? undefined : run;

	return run[0] === open[0] && run.length >= open.length && !rest.trim() ? null : undefined;
}

function dropLast(line: string, marker: string): string {
	const at = line.lastIndexOf(marker);

	return at < 0 ? line : line.slice(0, at) + line.slice(at + marker.length);
}
