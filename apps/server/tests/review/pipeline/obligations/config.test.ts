import { expect, test } from 'bun:test';
import { obligationCap, obligationTurns } from '../../../../src/review/pipeline/obligations/config';
import { restoreEnvAfterEach } from '../../../helpers/env';

const ENV = ['RECODER_OBLIGATION_CAP', 'RECODER_OBLIGATION_TURNS'] as const;

restoreEnvAfterEach([...ENV]);

/** Each setting read with `key` set to `value`, or unset for undefined. */
function read<T>(key: (typeof ENV)[number], value: string | undefined, setting: () => T): T {
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;

	return setting();
}

test('the cap defaults to 8 and takes any whole number from 0', () => {
	expect(
		[undefined, '', '-1', '2.5', 'many', '0', '3'].map((value) => read('RECODER_OBLIGATION_CAP', value, obligationCap))
	).toEqual([8, 8, 8, 8, 8, 0, 3]);
});

test('an investigation gets 8 turns by default, any whole number held between 3 and 12', () => {
	expect(
		[undefined, 'few', '4.5', '1', '3', '6', '20'].map((value) =>
			read('RECODER_OBLIGATION_TURNS', value, obligationTurns)
		)
	).toEqual([8, 8, 8, 3, 3, 6, 12]);
});
