/** One key press, as the prompts read it. */
export type Key =
	| { name: 'up' | 'down' | 'enter' | 'backspace' | 'escape' | 'interrupt' }
	/** One or more characters typed or pasted. */
	| { name: 'text'; text: string };

/** What a terminal sends for each key that is not text. Escape alone is read last, so an arrow is never taken for it. */
const SEQUENCES: readonly (readonly [sequence: string, key: Exclude<Key, { name: 'text' }>])[] = [
	['\u001b[A', { name: 'up' }],
	['\u001b[B', { name: 'down' }],
	['\u001bOA', { name: 'up' }],
	['\u001bOB', { name: 'down' }],
	['\u0010', { name: 'up' }],
	['\u000e', { name: 'down' }],
	['\r', { name: 'enter' }],
	['\n', { name: 'enter' }],
	['\u007f', { name: 'backspace' }],
	['\b', { name: 'backspace' }],
	['\u0003', { name: 'interrupt' }],
	['\u0004', { name: 'interrupt' }]
];

const ESCAPE = '\u001b';

/** The last character below the printable ones, and the one above them that is a control character too. */
const LAST_CONTROL_CODE = 0x1f;

const DELETE_CODE = 0x7f;

/** What ends an escape sequence that starts `ESC [`: a letter or a tilde. */
const SEQUENCE_END = /[A-Za-z~]/;

/** `ESC O` and one letter is how some terminals send a function or arrow key. */
const SHORT_SEQUENCE_LENGTH = 3;

/**
 * The keys in one chunk read from a terminal in raw mode. A chunk can hold several, when keys are pressed quickly
 * or text is pasted. Control characters the prompts do not know are dropped.
 */
export function parseKeys(chunk: string): Key[] {
	const keys: Key[] = [];
	let rest = chunk;

	while (rest !== '') {
		const { key, length } = readKey(rest);

		if (key !== null) keys.push(key);

		rest = rest.slice(length);
	}

	return keys;
}

/**
 * What starts the chunk and how many characters it takes, at least one: a known key, a sequence with no use (no
 * key), Escape alone, or text up to the next control character. A control character nothing knows is no key.
 */
function readKey(chunk: string): { key: Key | null; length: number } {
	const known = SEQUENCES.find(([sequence]) => chunk.startsWith(sequence));

	if (known) return { key: known[1], length: known[0].length };

	const unused = unusedSequenceLength(chunk);

	if (unused > 0) return { key: null, length: unused };

	if (chunk.startsWith(ESCAPE)) return { key: { name: 'escape' }, length: ESCAPE.length };

	const length = textLength(chunk);

	return length > 0 ? { key: { name: 'text', text: chunk.slice(0, length) }, length } : { key: null, length: 1 };
}

/**
 * The length of an escape sequence at the start of the chunk that the prompts have no use for, such as the left
 * arrow or a function key; 0 when the chunk starts with anything else.
 */
function unusedSequenceLength(chunk: string): number {
	if (chunk.startsWith(`${ESCAPE}O`) && chunk.length >= SHORT_SEQUENCE_LENGTH) return SHORT_SEQUENCE_LENGTH;

	if (!chunk.startsWith(`${ESCAPE}[`)) return 0;

	const end = chunk.slice(2).search(SEQUENCE_END);

	return end === -1 ? 0 : end + 2 + 1;
}

/** How many characters at the start of the chunk are plain text. */
function textLength(chunk: string): number {
	const end = [...chunk].findIndex(isControlCharacter);

	return end === -1 ? chunk.length : [...chunk].slice(0, end).join('').length;
}

function isControlCharacter(character: string): boolean {
	const code = character.charCodeAt(0);

	return code <= LAST_CONTROL_CODE || code === DELETE_CODE;
}
