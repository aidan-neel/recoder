import { afterEach, describe, expect, test } from 'bun:test';

import { readThreads, writeThreads } from '../../src/lib/ask/saved-threads';
import { memoryStorage } from '../fixtures';

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'sessionStorage');
});

describe('saved threads', () => {
	test('a reply cut short by a reload comes back stopped, or offers to ask again when it had said nothing', () => {
		globalThis.sessionStorage = memoryStorage();

		const question = { id: 'q', role: 'user' as const, text: 'Why?', state: 'done' as const };

		writeThreads('r1', {
			'decision:a': {
				messages: [question, { id: 'a', role: 'assistant', text: 'Because the', state: 'streaming' }]
			},
			'decision:b': {
				messages: [question, { id: 'b', role: 'assistant', text: '', state: 'streaming' }]
			}
		});

		const threads = readThreads().r1;

		expect(threads['decision:a'].messages.at(-1)).toMatchObject({ text: 'Because the', state: 'stopped' });

		expect(threads['decision:b'].messages.at(-1)).toMatchObject({
			text: '',
			state: 'failed',
			failure: { message: 'The reply stopped when the page reloaded.' }
		});
	});

	test('a corrupt entry is skipped instead of breaking every review', () => {
		globalThis.sessionStorage = memoryStorage();
		sessionStorage.setItem('recoder-ask:bad', '{not json');
		writeThreads('good', { 'decision:a': { messages: [] } });

		expect(Object.keys(readThreads())).toEqual(['good']);
	});
});
