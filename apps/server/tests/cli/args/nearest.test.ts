import { expect, test } from 'bun:test';
import { nearestOf } from '../../../src/cli/args/nearest';

const COMMANDS = ['review', 'status', 'wait', 'result', 'runs', 'init'];

test('a name one or two edits from a known one is taken for it', () => {
	expect(nearestOf('revew', COMMANDS)).toBe('review');
	expect(nearestOf('stauts', COMMANDS)).toBe('status');
});

test('a name far from every known one has no nearest', () => {
	expect(nearestOf('deploy', COMMANDS)).toBeNull();
});

test('a very short name is not matched to whatever happens to be near', () => {
	expect(nearestOf('x', COMMANDS)).toBeNull();
});
