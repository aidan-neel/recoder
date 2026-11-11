import { expect, test } from 'bun:test';
import { splitAudience } from '../../src/cli/audience';

test('-p anywhere among the flags means a program reads the output, and is taken out of argv', () => {
	expect(splitAudience(['review', '--staged', '-p', '--budget', 'low'])).toEqual({
		audience: 'program',
		argv: ['review', '--staged', '--budget', 'low']
	});

	expect(splitAudience(['--programmatic', 'runs']).audience).toBe('program');
});

test('with no flag a person reads the output and argv is untouched', () => {
	expect(splitAudience(['status', 'a1b2c3'])).toEqual({ audience: 'person', argv: ['status', 'a1b2c3'] });
});

test('a -p after -- is an argument, not the flag', () => {
	expect(splitAudience(['review', '--', '-p'])).toEqual({ audience: 'person', argv: ['review', '--', '-p'] });
});

test('a value written --flag=-p is not the flag', () => {
	expect(splitAudience(['review', '--title=-p']).audience).toBe('person');
});
