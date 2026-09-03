/**
 * Minimal syntax highlighter for diff code lines.
 *
 * Sync, dependency-free, and SSR-safe (unlike Shiki/highlight.js, which are
 * async and flash unhighlighted code). Tokenizes TypeScript-ish lines:
 * keywords, strings, comments, numbers, calls, and types. Multi-line block
 * comments are tracked across lines; multi-line template literals are not
 * (acceptable v1 tradeoff — noted where it matters).
 *
 * Colors come from `--hl-*` variables (both themes) so highlights stay
 * legible in light and dark mode.
 */

export interface HlState {
	inBlockComment: boolean;
}

const HL_COLOR = {
	keyword: 'var(--hl-keyword)',
	string: 'var(--hl-string)',
	comment: 'var(--hl-comment)',
	number: 'var(--hl-number)',
	fn: 'var(--hl-fn)',
	type: 'var(--hl-type)',
	attr: 'var(--hl-attr)'
} as const;

type HlKind = keyof typeof HL_COLOR;

const KEYWORDS = new Set(
	(
		'import export from as default return if else for while do switch case break continue ' +
		'const let var function class extends implements interface type enum namespace new typeof this super ' +
		'public private protected readonly static abstract async await try catch finally throw ' +
		'true false null undefined void delete in of instanceof satisfies infer never unknown any ' +
		'get set constructor declare override'
	).split(' ')
);

/** Match: line comment | block comment | string | number | identifier. */
const TOKEN_RE =
	/(\/\/.*$)|(\/\*(?:[^*]|\*(?!\/))*(?:\*\/)?)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\\n]|\\.)*`)|\b(\d[\w]*(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)/g;

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function span(text: string, kind: HlKind): string {
	return `<span style="color:${HL_COLOR[kind]}">${escapeHtml(text)}</span>`;
}

function highlightRest(line: string, out: string[]): void {
	TOKEN_RE.lastIndex = 0;
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = TOKEN_RE.exec(line)) !== null) {
		if (m.index > last) out.push(escapeHtml(line.slice(last, m.index)));
		const [tok, lineComment, blockComment, str, num, ident] = m;
		if (lineComment || blockComment) {
			out.push(span(tok, 'comment'));
		} else if (str) {
			out.push(span(tok, 'string'));
		} else if (num) {
			out.push(span(tok, 'number'));
		} else if (ident) {
			if (KEYWORDS.has(ident)) {
				out.push(span(tok, 'keyword'));
			} else {
				const next = line[TOKEN_RE.lastIndex];
				if (next === '(') out.push(span(tok, 'fn'));
				else if (next === '=') out.push(span(tok, 'attr'));
				else if (/^[A-Z]/.test(ident)) out.push(span(tok, 'type'));
				else out.push(escapeHtml(tok));
			}
		}
		last = m.index + tok.length;
	}
	if (last < line.length) out.push(escapeHtml(line.slice(last)));
}

/** Highlight one line, threading block-comment state. Returns HTML + next state. */
export function highlightLine(line: string, state: HlState): { html: string; state: HlState } {
	const out: string[] = [];
	if (state.inBlockComment) {
		const end = line.indexOf('*/');
		if (end === -1) return { html: span(line, 'comment'), state };
		out.push(span(line.slice(0, end + 2), 'comment'));
		highlightRest(line.slice(end + 2), out);
		return { html: out.join(''), state: { inBlockComment: false } };
	}
	const start = line.indexOf('/*');
	if (start !== -1) {
		highlightRest(line.slice(0, start), out);
		const rest = line.slice(start);
		const end = rest.indexOf('*/', 2);
		if (end === -1) {
			out.push(span(rest, 'comment'));
			return { html: out.join(''), state: { inBlockComment: true } };
		}
		out.push(span(rest.slice(0, end + 2), 'comment'));
		highlightRest(rest.slice(end + 2), out);
		return { html: out.join(''), state };
	}
	highlightRest(line, out);
	return { html: out.join(''), state };
}

/** Highlight an ordered list of lines (e.g. one hunk). Output aligns 1:1. */
export function highlightLines(lines: string[]): string[] {
	let state: HlState = { inBlockComment: false };
	return lines.map((line) => {
		const result = highlightLine(line, state);
		state = result.state;
		return result.html;
	});
}
