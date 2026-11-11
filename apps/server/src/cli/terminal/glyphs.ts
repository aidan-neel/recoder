/** The symbols the views draw with. */
export interface Glyphs {
	ok: string;
	fail: string;
	warn: string;
	/** A step that has not started. */
	pending: string;
	/** A severity mark, and a run that is going. */
	dot: string;
	/** Between facts on one line. */
	separator: string;
	arrow: string;
	/** The option a prompt's cursor is on. */
	pointer: string;
	rule: string;
	/** The left edge of a quoted block, such as a patch. */
	bar: string;
	ellipsis: string;
	/** One frame per tick of something that is running. */
	spinner: readonly string[];
}

const UNICODE: Glyphs = {
	ok: '✓',
	fail: '✗',
	warn: '!',
	pending: '○',
	dot: '●',
	separator: '·',
	arrow: '→',
	pointer: '❯',
	rule: '─',
	bar: '│',
	ellipsis: '…',
	spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
};

const ASCII: Glyphs = {
	ok: '+',
	fail: 'x',
	warn: '!',
	pending: 'o',
	dot: '*',
	separator: '-',
	arrow: '->',
	pointer: '>',
	rule: '-',
	bar: '|',
	ellipsis: '...',
	spinner: ['-', '\\', '|', '/']
};

/** The Unicode symbols, or plain ASCII ones for a terminal that cannot show them. */
export function glyphsFor(hasUnicode: boolean): Glyphs {
	return hasUnicode ? UNICODE : ASCII;
}
