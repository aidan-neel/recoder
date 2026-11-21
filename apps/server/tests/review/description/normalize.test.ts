import { expect, test } from 'bun:test';
import { normalizeDescription } from '../../../src/review/description/normalize';

const group = (title: string, paths: string[]) => ({
	title,
	note: ' The change. ',
	explanation: ' The implementation. ',
	paths
});

test('normalization drops unknown paths, keeps the first group for duplicates, and groups every missing file', () => {
	const groups = [
		group(' Start here. ', [' z.ts ', 'z.ts', 'invented.ts', 'a.ts']),
		group('Only duplicates', ['z.ts']),
		group(' Next ', ['a.ts', 'b.ts'])
	];

	const raw = JSON.stringify({ summary: ' **Summary.** ', groups, notes: [' first ', '', 123, '2', '3', '4', '5'] });
	const parsed = normalizeDescription(`\`\`\`json\n${raw}\n\`\`\``, ['a.ts', 'b.ts', 'c.ts', 'z.ts', 'd.ts']);

	expect(parsed).toMatchObject({
		summary: '**Summary.**',
		groups: [
			{
				id: 'g1',
				title: 'Start here',
				note: 'The change.',
				explanation: 'The implementation.',
				paths: ['z.ts', 'a.ts']
			},
			{ id: 'g2', title: 'Next', paths: ['b.ts'] },
			{ id: 'g3', title: 'Other changes', note: 'Files the description did not group.', paths: ['c.ts', 'd.ts'] }
		],
		notes: ['first', '2', '3', '4']
	});
});

const overflowPaths = Array.from({ length: 10 }, (_, i) => `${i}.ts`);

const overflowReply = JSON.stringify({
	summary: 'Changes the files.',
	groups: overflowPaths.map((path) => group(path, [path]))
});

test('overflow merges into the eighth group when there are no missing files', () => {
	const parsed = normalizeDescription(overflowReply, overflowPaths);

	expect(parsed?.groups).toHaveLength(8);
	expect(parsed?.groups.at(-1)).toMatchObject({ id: 'g8', paths: overflowPaths.slice(7) });
});

test('a missing file reserves the eighth group for Other changes', () => {
	const parsed = normalizeDescription(overflowReply, [...overflowPaths, 'forgotten.ts']);

	expect(parsed?.groups).toHaveLength(8);
	expect(parsed?.groups.at(-2)).toMatchObject({ id: 'g7', paths: overflowPaths.slice(6) });
	expect(parsed?.groups.at(-1)).toMatchObject({ id: 'g8', title: 'Other changes', paths: ['forgotten.ts'] });
});

test.each(['not JSON', '{"summary":', '["not an object"]', '{"summary":"  "}'])(
	'invalid output fails without throwing: %s',
	(output) => {
		expect(normalizeDescription(output, ['a.ts'])).toBeNull();
	}
);
