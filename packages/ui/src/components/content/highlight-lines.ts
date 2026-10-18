import { highlightCode } from './highlight';

/** What line highlighting needs from a diff line. */
interface SourceLine {
	type: 'context' | 'add' | 'del';
	text: string;
}

const TOKEN = /<span class="[^"]*">|<\/span>|[^<]+/g;

/**
 * Splits highlight.js HTML into one string per source line. A span that a
 * newline cuts through (a block comment, a template string) is closed at the
 * end of the line and reopened on the next, so every line is valid HTML.
 */
function splitLines(html: string): string[] {
	const lines: string[] = [];
	const open: string[] = [];

	let current = '';

	for (const [token] of html.matchAll(TOKEN)) {
		if (token.startsWith('<span')) {
			open.push(token);
			current += token;
		} else if (token === '</span>') {
			open.pop();
			current += token;
		} else {
			const [first, ...rest] = token.split('\n');

			current += first;

			for (const part of rest) {
				lines.push(current + '</span>'.repeat(open.length));
				current = open.join('') + part;
			}
		}
	}

	lines.push(current);

	return lines;
}

/**
 * Highlights consecutive lines as one text, so a construct spanning lines
 * keeps its colors, then splits the result back into lines. Falls back to
 * line-by-line highlighting if a line itself held a newline.
 */
function highlightRun(texts: string[], lang: string | null): string[] {
	const lines = splitLines(highlightCode(texts.join('\n'), lang));

	return lines.length === texts.length ? lines : texts.map((text) => highlightCode(text, lang));
}

/** Highlights one side of a diff (context plus `type` lines), keyed by the line's index. */
function highlightSide(lines: readonly SourceLine[], type: 'add' | 'del', lang: string | null): Map<number, string> {
	const picked = lines.flatMap((line, index) => (line.type === 'context' || line.type === type ? [index] : []));

	const html = highlightRun(
		picked.map((index) => lines[index].text),
		lang
	);

	return new Map(picked.map((lineIndex, at) => [lineIndex, html[at]]));
}

/**
 * Highlighted HTML for each diff line. The new side (context and added lines)
 * and the old side (context and removed lines) are highlighted separately, so
 * each reads as the file it came from.
 */
export function highlightDiff(lines: readonly SourceLine[], lang: string | null): string[] {
	const after = highlightSide(lines, 'add', lang);
	const before = lines.some((line) => line.type === 'del') ? highlightSide(lines, 'del', lang) : after;

	return lines.map((line, index) => (line.type === 'del' ? before.get(index) : after.get(index)) ?? '');
}
