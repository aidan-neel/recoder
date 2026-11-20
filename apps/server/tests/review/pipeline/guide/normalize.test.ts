import { expect, test } from 'bun:test';
import { normalizeDiffGuide } from '../../../../src/review/pipeline/guide/normalize';
import { seedDiffGuide } from '../../../../src/review/pipeline/guide/seed';
import { added, newRun } from './fixtures';

test('normalization keeps one trusted assignment per hunk and restores omissions to their seed group', () => {
	const run = newRun(added('one.ts', 'alpha();') + added('two.ts', 'bravo();'));
	const seed = seedDiffGuide(run.inventory, null);
	const first = seed.groups[0].hunks[0];

	const reply = {
		groups: [
			{
				title: 'Refined',
				explanation: 'Read this first.',
				hunks: [
					{ id: first.id, explanation: 'First occurrence.' },
					{ id: 'invented', explanation: 'Unknown.' }
				]
			},
			{
				title: 'Duplicate',
				explanation: 'Read twice.',
				hunks: [{ id: first.id, explanation: 'Duplicate occurrence.' }]
			}
		]
	};

	const guide = normalizeDiffGuide(reply, seed)!;

	expect(guide.groups).toHaveLength(2);
	expect(guide.groups[0].hunks).toEqual([{ ...first, explanation: 'First occurrence.' }]);
	expect(guide.groups[1]).toEqual(seed.groups[1]);
	expect(new Set(guide.groups.flatMap((group) => group.hunks.map((hunk) => hunk.id))).size).toBe(2);
});

test('a model cannot explain, reassign or replace trusted pure-move metadata', () => {
	const seed = seedDiffGuide(
		newRun('diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n').inventory,
		null
	);

	const id = seed.groups[0].hunks[0].id;

	expect(
		normalizeDiffGuide(
			{
				groups: [
					{
						title: 'Override',
						explanation: 'Wrong.',
						hunks: [{ id, file: 'invented.ts', note: 'forged', explanation: 'New behavior.' }]
					}
				]
			},
			seed
		)
	).toEqual(seed);
});

test('invalid model shapes fall back completely while an empty valid reply restores every seed hunk', () => {
	const seed = seedDiffGuide(newRun().inventory, null);

	expect(normalizeDiffGuide({ groups: 'wrong' }, seed)).toBeNull();
	expect(normalizeDiffGuide({ groups: [] }, seed)).toEqual(seed);
	expect(normalizeDiffGuide(null, seed)).toBeNull();
});
