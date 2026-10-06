import { expect, test } from 'bun:test';
import { obligationCap, obligationTurns, obligationsOn } from '../../../../src/review/pipeline/obligations/config';
import { restoreEnvAfterEach } from './fixtures';

const ENV = ['RECODER_OBLIGATIONS', 'RECODER_OBLIGATION_CAP', 'RECODER_OBLIGATION_TURNS'] as const;

restoreEnvAfterEach([...ENV]);

/** Each setting read with `key` set to `value`, or unset for undefined. */
function read<T>(key: (typeof ENV)[number], value: string | undefined, setting: () => T): T {
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;

	return setting();
}

test('obligations are off unless RECODER_OBLIGATIONS is exactly 1', () => {
	expect([undefined, '', '0', 'true', '1'].map((value) => read('RECODER_OBLIGATIONS', value, obligationsOn))).toEqual([
		false,
		false,
		false,
		false,
		true
	]);
});

test('the cap defaults to 6 and takes any whole number from 0', () => {
	expect(
		[undefined, '', '-1', '2.5', 'many', '0', '3'].map((value) => read('RECODER_OBLIGATION_CAP', value, obligationCap))
	).toEqual([6, 6, 6, 6, 6, 0, 3]);
});

test('an investigation gets 6 turns by default, any whole number held between 3 and 12', () => {
	expect(
		[undefined, 'few', '4.5', '1', '3', '8', '20'].map((value) =>
			read('RECODER_OBLIGATION_TURNS', value, obligationTurns)
		)
	).toEqual([6, 6, 6, 3, 3, 8, 12]);
});
