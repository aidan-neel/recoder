import { expect, test } from 'bun:test';
import { streamedMessage } from './response-text';

test('streams readable JSON text across escaped strings without leaking control fields', () => {
	const value = JSON.stringify({ message: 'Check "caller"\n**Evidence**: C:\\src\t✓', actions: [{ action: 'readFile' }] });
	for (let i = 1; i <= value.length; i++) {
		const partial = streamedMessage(value.slice(0, i));
		expect('Check "caller"\n**Evidence**: C:\\src\t✓'.startsWith(partial)).toBe(true);
	}
	expect(streamedMessage(value)).toBe('Check "caller"\n**Evidence**: C:\\src\t✓');
	expect(streamedMessage('{"actions":[],"message":"hidden"}')).toBe('');
	expect(streamedMessage('{"message":"a\\u00')).toBe('a');
	expect(streamedMessage('{"message":"a\\u0041"}')).toBe('aA');
});
