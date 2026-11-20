import { expect, test } from 'bun:test';
import { parseDevinModels } from '../../../src/agents/devin/devin-models';

test('fractional context windows remain discoverable alongside integer K and M windows', () => {
	const output = [
		'  gemini-4-hydrogen-low  Hydrogen Low  [1.05M context, $1.5 / 1M Input]',
		'  swe-2-high  SWE-2 High  [262K context, Free]',
		'  other  Other  [1M context, Free]',
		'  adaptive  Adaptive  [Free]',
		'  broken  Broken  [1..05M context, Free]'
	].join('\n');

	expect(parseDevinModels(output).map((entry) => [entry.model, entry.contextWindow])).toEqual([
		['gemini-4-hydrogen-low', 1050000],
		['swe-2-high', 262000],
		['other', 1000000]
	]);
});
