import type { Key } from './keys.js';
import type { Prompt, PromptStep } from './prompt.js';

const MARGIN = '  ';

/** A prompt that asks yes or no: `y` or `n` answers, and Enter takes the default. */
export function confirmPrompt(message: string, defaultAnswer: boolean): Prompt<null, boolean> {
	return {
		initial: null,
		reduce: (_, key) => reduceConfirm(key, defaultAnswer),
		view: (_, { paint }) => [
			`${MARGIN}${paint.info('?')} ${paint.strong(message)} ${paint.muted(defaultAnswer ? '(Y/n)' : '(y/N)')}`
		]
	};
}

function reduceConfirm(key: Key, defaultAnswer: boolean): PromptStep<null, boolean> {
	if (key.name === 'interrupt' || key.name === 'escape') return { kind: 'cancelled' };

	if (key.name === 'enter') return { kind: 'answered', answer: defaultAnswer };

	const letter = key.name === 'text' ? key.text[0]?.toLowerCase() : undefined;

	if (letter === 'y') return { kind: 'answered', answer: true };

	return letter === 'n' ? { kind: 'answered', answer: false } : { kind: 'continue', state: null };
}
