import { escapeHtml } from '@recoder/ui';

/** What a piece of a shell command is, when it is more than a plain word. */
type ShellTokenKind = 'flag' | 'placeholder' | 'value' | 'operator' | 'comment';

/** A piece of a command line. Whitespace and plain words have no kind. */
interface ShellToken {
	text: string;
	kind: ShellTokenKind | null;
}

/**
 * The pieces of one line, in order: runs of space, a `<placeholder>` or
 * `[optional]`, a word (quoted parts stay inside it) and a quote with no
 * partner. Every character matches one of them, so no text is lost.
 */
const PIECE = /\s+|<[^<>\s](?:[^<>]*[^<>\s])?>|\[[^[\]]+\]|(?:[^\s"']|"[^"]*"|'[^']*')+|["']/g;

const LONG_FLAG = /^--[A-Za-z][\w-]*$/;

const SHORT_FLAG = /^-[A-Za-z]+$/;

/** A long flag with its value attached: `--format=json`. */
const FLAG_WITH_VALUE = /^(--[A-Za-z][\w-]*)=(.+)$/;

const PLACEHOLDER = /^(?:<.+>|\[.+\])$/;

/** A choice of words: `low|medium|high`. */
const CHOICE = /^[\w-]+(?:\|[\w-]+)+$/;

const OPERATORS = new Set(['|', '||', '&&', ';', '>', '>>', '<', '--']);

const URL = /^https?:\/\//;

/** A word's kind from the word alone, or null for a plain word. */
function wordKind(word: string): ShellTokenKind | null {
	if (OPERATORS.has(word)) return 'operator';

	if (LONG_FLAG.test(word) || SHORT_FLAG.test(word)) return 'flag';

	if (PLACEHOLDER.test(word) || CHOICE.test(word)) return 'placeholder';

	if (URL.test(word) || /^["']/.test(word)) return 'value';

	return null;
}

/** The tokens of one line. A plain word right after a long flag is that flag's value. */
function lineTokens(line: string): ShellToken[] {
	const tokens: ShellToken[] = [];
	let afterLongFlag = false;

	for (const [piece] of line.matchAll(PIECE)) {
		if (piece.startsWith('#')) {
			const start = tokens.reduce((length, token) => length + token.text.length, 0);

			return [...tokens, { text: line.slice(start), kind: 'comment' }];
		}

		if (!piece.trim()) {
			tokens.push({ text: piece, kind: null });
			continue;
		}

		const attached = FLAG_WITH_VALUE.exec(piece);

		if (attached) {
			tokens.push({ text: attached[1], kind: 'flag' }, { text: '=', kind: null }, { text: attached[2], kind: 'value' });
			afterLongFlag = false;
			continue;
		}

		const kind = wordKind(piece);

		tokens.push({ text: piece, kind: kind ?? (afterLongFlag ? 'value' : null) });
		afterLongFlag = LONG_FLAG.test(piece);
	}

	return tokens;
}

/** One token as HTML: its text escaped, in a span that names its kind when it has one. */
function tokenHtml({ text, kind }: ShellToken): string {
	const escaped = escapeHtml(text);

	return kind ? `<span data-token="${kind}">${escaped}</span>` : escaped;
}

/**
 * A shell command as HTML for the docs: flags, `<placeholders>`, values,
 * operators and `#` comments each sit in a span the docs styles color. The
 * kit's shell grammar colors none of the first three. The result holds only
 * the source's own text, escaped, and those spans.
 */
export function shellHtml(code: string): string {
	return code
		.split('\n')
		.map((line) => lineTokens(line).map(tokenHtml).join(''))
		.join('\n');
}
