import type { Surface } from '../surface.js';
import { indent, padEnd } from '../text.js';
import type { Key } from './keys.js';
import type { Prompt, PromptStep } from './prompt.js';

const MARGIN = 2;

const OPTION_INDENT = 4;

const COLUMN_GAP = 3;

/** The most options shown at once; a longer list scrolls with the cursor. */
const MAX_VISIBLE_OPTIONS = 8;

/** The letters that move the cursor in a list that is not filtered, as in vi. */
const VI_MOVES: Record<string, number> = { j: 1, k: -1 };

/** One choice: what choosing it gives, how it is named, and a few words about it. */
export interface SelectOption<Value> {
	value: Value;
	label: string;
	hint?: string;
}

/** A question with one answer out of a list. */
interface SelectQuestion<Value> {
	message: string;
	options: readonly SelectOption<Value>[];
	/** Whether typing narrows the list, for a list too long to scan. */
	isFilterable: boolean;
}

/** What the person has typed to narrow the list, and which of the options left the cursor is on. */
interface SelectState {
	query: string;
	cursor: number;
}

/** A prompt that asks for one of the options: the arrows move, typing narrows a filterable list, Enter chooses. */
export function selectPrompt<Value>(question: SelectQuestion<Value>): Prompt<SelectState, SelectOption<Value>> {
	return {
		initial: { query: '', cursor: 0 },
		reduce: (state, key) => reduceSelect(question, state, key),
		view: (state, surface) => selectView(question, state, surface)
	};
}

function reduceSelect<Value>(
	question: SelectQuestion<Value>,
	state: SelectState,
	key: Key
): PromptStep<SelectState, SelectOption<Value>> {
	const matching = matchingOptions(question, state.query);

	switch (key.name) {
		case 'interrupt':
		case 'escape':
			return { kind: 'cancelled' };
		case 'enter':
			return matching.length > 0 ? { kind: 'answered', answer: matching[state.cursor] } : { kind: 'continue', state };
		case 'up':
			return { kind: 'continue', state: { ...state, cursor: wrapCursor(state.cursor - 1, matching.length) } };
		case 'down':
			return { kind: 'continue', state: { ...state, cursor: wrapCursor(state.cursor + 1, matching.length) } };
		case 'backspace':
			return { kind: 'continue', state: { query: state.query.slice(0, -1), cursor: 0 } };
		case 'text':
			return { kind: 'continue', state: typed(question, state, key.text) };
	}
}

/** Typing narrows a filterable list and puts the cursor back on its first option. Elsewhere `j` and `k` move. */
function typed<Value>(question: SelectQuestion<Value>, state: SelectState, text: string): SelectState {
	if (question.isFilterable) return { query: state.query + text, cursor: 0 };

	const moves = [...text].reduce((sum, character) => sum + (VI_MOVES[character] ?? 0), 0);

	return { ...state, cursor: wrapCursor(state.cursor + moves, question.options.length) };
}

/** The cursor moved to `index`, going round from the last option to the first and back. */
function wrapCursor(index: number, length: number): number {
	return length === 0 ? 0 : (index + length) % length;
}

/** The options whose label or hint holds every word typed, ignoring case. */
function matchingOptions<Value>(question: SelectQuestion<Value>, query: string): readonly SelectOption<Value>[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);

	if (words.length === 0) return question.options;

	return question.options.filter((option) => {
		const text = `${option.label} ${option.hint ?? ''}`.toLowerCase();

		return words.every((word) => text.includes(word));
	});
}

function selectView<Value>(question: SelectQuestion<Value>, state: SelectState, surface: Surface): string[] {
	const { paint } = surface;
	const matching = matchingOptions(question, state.query);
	const typedText = question.isFilterable ? ` ${state.query}${paint.muted('_')}` : '';
	const first = windowStart(state.cursor, matching.length);
	const visible = matching.slice(first, first + MAX_VISIBLE_OPTIONS);
	const width = Math.max(0, ...visible.map((option) => option.label.length));

	const rows = visible.map((option, index) =>
		optionRow(option, { isCurrent: first + index === state.cursor, width }, surface)
	);

	return [
		'',
		`${' '.repeat(MARGIN)}${paint.info('?')} ${paint.strong(question.message)}${typedText}`,
		...indent(rows.length > 0 ? rows : [paint.muted('Nothing matches.')], OPTION_INDENT),
		'',
		...indent([paint.muted(keyHelp(question, matching.length, surface))], OPTION_INDENT),
		''
	];
}

/** The first option shown, so the cursor stays inside the window and the window stays inside the list. */
function windowStart(cursor: number, length: number): number {
	const centered = cursor - Math.floor(MAX_VISIBLE_OPTIONS / 2);

	return Math.max(0, Math.min(centered, length - MAX_VISIBLE_OPTIONS));
}

function optionRow<Value>(
	option: SelectOption<Value>,
	row: { isCurrent: boolean; width: number },
	{ paint, glyphs }: Surface
): string {
	const hint = option.hint ? `${' '.repeat(COLUMN_GAP)}${paint.muted(option.hint)}` : '';
	const label = padEnd(option.label, row.width);

	return row.isCurrent ? `${paint.info(glyphs.pointer)} ${paint.strong(label)}${hint}` : `  ${label}${hint}`;
}

function keyHelp<Value>(question: SelectQuestion<Value>, matches: number, { glyphs }: Surface): string {
	const count = question.isFilterable ? [`${matches} of ${question.options.length}`, 'type to filter'] : [];

	return [...count, 'arrows move', 'enter chooses', 'esc leaves'].join(` ${glyphs.separator} `);
}
