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
	let out = text.replace(/\r\n?/g, '\n');

	// A reply wrapped whole in ```markdown … ``` renders as a code block.
	const wrapped = /^\s*```(?:markdown|md|text)?\n([\s\S]*?)\n?```\s*$/i.exec(out);
	if (wrapped) out = wrapped[1];
	else if (!complete) out = out.replace(/^\s*```(?:markdown|md)\n/i, '');

	// "\n" written out as two characters: the model escaped for JSON twice.
	// Only when there are no real line breaks, so code that mentions "\n" is safe.
	if (!out.includes('\n') && /\\n/.test(out)) {
		out = out.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
	}

	const lines = out.split('\n');
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
		if (inFence) continue;
		// Headings read as shouting in a chat reply; keep the words, as bold once the line is whole.
		const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
		if (heading) {
			const whole = complete || i < lines.length - 1;
			lines[i] = whole && heading[1] ? `**${heading[1].replace(/\*\*/g, '')}**` : heading[1];
			continue;
		}
		// Bullets markdown doesn't know.
		lines[i] = line.replace(/^(\s*)[•●▪‣◦·]\s+/, '$1- ');
	}
	out = lines.join('\n');

	// A list straight after a paragraph line needs a blank line in some renderers.
	out = out.replace(/^([^\n\-*\d\s|>`][^\n]*)\n(\s*(?:[-*+]|\d+[.)])\s)/gm, '$1\n\n$2');
	out = out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '');

	if (complete) out = balanceMarkers(out);
	return out.trim();
}

/** Close a code fence left open, and drop a lone `**` or backtick that would swallow the rest of a line. */
function balanceMarkers(text: string): string {
	let out = text;
	if ((out.match(/^\s*```/gm)?.length ?? 0) % 2 === 1) out += '\n```';
	const lines = out.split('\n');
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		if (/^\s*```/.test(lines[i])) { inFence = !inFence; continue; }
		if (inFence) continue;
		let line = lines[i];
		if ((line.match(/`/g)?.length ?? 0) % 2 === 1) line = dropLast(line, '`');
		// Count bold markers outside code spans.
		const bare = line.replace(/`[^`]*`/g, '');
		if ((bare.match(/\*\*/g)?.length ?? 0) % 2 === 1) line = dropLast(line, '**');
		lines[i] = line;
	}
	return lines.join('\n');
}

function dropLast(line: string, marker: string): string {
	const at = line.lastIndexOf(marker);
	return at < 0 ? line : line.slice(0, at) + line.slice(at + marker.length);
}
