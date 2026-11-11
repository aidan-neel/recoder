import { expect, test } from 'bun:test';
import type { Key } from '../../../../src/cli/terminal/prompt/keys';
import { selectPrompt } from '../../../../src/cli/terminal/prompt/select';

const MODELS = [
	{ value: 'a', label: 'claude-code:opus', hint: 'Opus · Claude Code' },
	{ value: 'b', label: 'claude-code:sonnet', hint: 'Sonnet · Claude Code' },
	{ value: 'c', label: 'opencode:openai/gpt', hint: 'GPT · OpenAI' }
];

const text = (typed: string): Key => ({ name: 'text', text: typed });

/** Presses the keys on a prompt for `MODELS` and returns how it ended: the chosen value, `cancelled`, or still open. */
function press(keys: Key[], isFilterable: boolean): string {
	const prompt = selectPrompt({ message: 'Which model?', options: MODELS, isFilterable });
	let state = prompt.initial;

	for (const key of keys) {
		const step = prompt.reduce(state, key);

		if (step.kind === 'answered') return step.answer.value;

		if (step.kind === 'cancelled') return 'cancelled';

		state = step.state;
	}

	return 'open';
}

test('Enter chooses the option under the cursor, which the arrows move', () => {
	expect(press([{ name: 'enter' }], false)).toBe('a');
	expect(press([{ name: 'down' }, { name: 'down' }, { name: 'enter' }], false)).toBe('c');
});

test('the cursor goes round from the first option to the last', () => {
	expect(press([{ name: 'up' }, { name: 'enter' }], false)).toBe('c');
});

test('typing narrows a filterable list by every word, in the label or the hint, ignoring case', () => {
	expect(press([text('OPENAI gpt'), { name: 'enter' }], true)).toBe('c');
	expect(press([text('sonnet'), { name: 'enter' }], true)).toBe('b');
});

test('Enter on a filter that matches nothing chooses nothing, and backspace widens it again', () => {
	expect(press([text('zzz'), { name: 'enter' }], true)).toBe('open');
	expect(press([text('sonnetx'), { name: 'backspace' }, { name: 'enter' }], true)).toBe('b');
});

test('in a list that is not filtered, j and k move the cursor', () => {
	expect(press([text('jj'), text('k'), { name: 'enter' }], false)).toBe('b');
});

test('Escape and Ctrl-C leave without choosing', () => {
	expect(press([{ name: 'escape' }], true)).toBe('cancelled');
	expect(press([{ name: 'down' }, { name: 'interrupt' }], false)).toBe('cancelled');
});
