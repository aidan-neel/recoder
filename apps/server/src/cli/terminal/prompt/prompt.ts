import { CliError, EXIT } from '../../exit.js';
import { guardedStderr } from '../../output/streams.js';
import { LiveRegion } from '../live-region.js';
import type { Surface } from '../surface.js';
import type { Terminal } from '../terminal.js';
import { parseKeys, type Key } from './keys.js';

/** What a key press does to a prompt: change what it shows, answer it, or leave it. */
export type PromptStep<State, Answer> =
	{ kind: 'continue'; state: State } | { kind: 'answered'; answer: Answer } | { kind: 'cancelled' };

/** A question asked on the terminal: how it starts, what each key does, and how it looks. */
export interface Prompt<State, Answer> {
	initial: State;
	reduce: (state: State, key: Key) => PromptStep<State, Answer>;
	view: (state: State, surface: Surface) => string[];
}

/** Whether a question can be asked: a person reads the output, and both the keyboard and standard error are a terminal. */
export function canPrompt(terminal: Terminal): boolean {
	return terminal.audience === 'person' && process.stdin.isTTY === true && terminal.err.isInteractive;
}

/**
 * Asks a question on standard error and resolves with the answer. The question is removed once it is answered: what
 * the caller prints next says what was chosen. The keyboard is read key by key for as long as the question is up, so
 * Ctrl-C arrives as a key: it and Escape leave the question, which ends the command as cancelled.
 */
export function ask<State, Answer>(prompt: Prompt<State, Answer>, surface: Surface): Promise<Answer> {
	const input = process.stdin;
	const region = new LiveRegion(guardedStderr(), surface.glyphs.ellipsis);
	let state = prompt.initial;

	return new Promise((resolve, reject) => {
		const leave = (): void => {
			input.off('data', onData);
			input.setRawMode(false);
			input.pause();
			region.close();
		};

		const onData = (chunk: Buffer): void => {
			for (const key of parseKeys(chunk.toString('utf8'))) {
				const step = prompt.reduce(state, key);

				if (step.kind === 'cancelled') {
					leave();
					reject(new CliError('Cancelled.', EXIT.cancelled));

					return;
				}

				if (step.kind === 'answered') {
					leave();
					resolve(step.answer);

					return;
				}

				state = step.state;
			}

			region.render(prompt.view(state, surface));
		};

		input.setRawMode(true);
		input.resume();
		input.on('data', onData);
		region.render(prompt.view(state, surface));
	});
}
