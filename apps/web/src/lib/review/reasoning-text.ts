const BLOCK_START = /^\s*(?:```|~~~|[-*+]\s|\d+[.)]\s|#{1,6}\s|>|\|)/;

/**
 * Model reasoning is plain text written line by line, not markdown: a single
 * newline means a new line, which markdown would fold into the paragraph
 * before it. Keep those breaks (outside code fences, and not where markdown
 * already starts a new block).
 */
export function reasoningMarkdown(text: string): string {
	const lines = text.split('\n');
	let fenced = false;

	return lines
		.map((line, i) => {
			if (/^\s*(?:```|~~~)/.test(line)) {
				fenced = !fenced;

				return line;
			}

			const next = lines[i + 1];

			if (fenced || !line.trim() || next === undefined || !next.trim() || BLOCK_START.test(next)) return line;
			if (/^\s*(?:#{1,6}\s|\|)/.test(line) || /(?: {2}|\\)$/.test(line)) return line;

			return `${line}\\`;
		})
		.join('\n');
}
