import { expect, test } from 'bun:test';
import type { ChangeModel } from '../../../../src/review/pipeline/change-model/types';
import { seedDiffGuide } from '../../../../src/review/pipeline/guide/seed';
import { added, newRun } from './fixtures';

test('imports lead to definitions before callers, with paired tests afterward and ancillary files last', () => {
	const sections = [
		added('src/a-caller.ts', "import { resolve } from './z-core.js';\nexport const use = () => resolve();"),
		added('tests/z-core.test.ts', 'assert(true);'),
		added('src/z-core.ts', 'export const resolve = () => 42;'),
		added('tsconfig.json', '{}'),
		added('README.md', '# Details')
	];

	const forward = newRun(sections.join(''));
	const reverse = newRun([...sections].reverse().join(''));
	const guide = seedDiffGuide(forward.inventory, null);

	expect(guide).toEqual(seedDiffGuide(reverse.inventory, null));

	expect(guide.groups[0].hunks.map((hunk) => hunk.file)).toEqual([
		'src/z-core.ts',
		'src/a-caller.ts',
		'tests/z-core.test.ts'
	]);

	expect(guide.groups.slice(1).flatMap((group) => group.hunks.map((hunk) => hunk.file))).toEqual([
		'README.md',
		'tsconfig.json'
	]);
});

test('shared changed identifiers connect related files but common language tokens do not join everything', () => {
	const run = newRun(
		added('one.ts', 'export const pendingWork = 1;') +
			added('two.ts', 'export const queued = pendingWork;') +
			added('other.ts', 'export const isolated = 0;')
	);

	const groups = seedDiffGuide(run.inventory, null).groups;

	expect(groups.map((group) => group.hunks.map((hunk) => hunk.file))).toEqual([['one.ts', 'two.ts'], ['other.ts']]);
});

test('relative imports link both a matching file and its directory index without linking same-name files elsewhere', () => {
	const run = newRun(
		added('src/a-caller.ts', "import './z.js';") +
			added('src/z.ts', 'export const flat = 1;') +
			added('src/z/index.ts', 'export const nested = 2;') +
			added('unrelated/z/index.ts', 'export const separate = 3;')
	);

	const groups = seedDiffGuide(run.inventory, null).groups;

	expect(groups.map((group) => group.hunks.map((hunk) => hunk.file))).toEqual([
		['src/z.ts', 'src/z/index.ts', 'src/a-caller.ts'],
		['unrelated/z/index.ts']
	]);
});

test('parser reference edges group changed definitions with callers even without matching patch identifiers', () => {
	const run = newRun(added('a-caller.ts', 'alpha();') + added('z-core.ts', 'beta();'));

	const model = {
		symbols: [{ file: 'z-core.ts', references: [{ file: 'a-caller.ts' }], tests: [] }]
	} as unknown as ChangeModel;

	expect(seedDiffGuide(run.inventory, model).groups[0].hunks.map((hunk) => hunk.file)).toEqual([
		'z-core.ts',
		'a-caller.ts'
	]);
});

test('a test is grouped with all matching sources in its feature, regardless of their structural folders', () => {
	const run = newRun(
		added('src/feature/core.ts', 'export const first = 1;') +
			added('lib/feature/core.py', 'def second(): pass') +
			added('tests/feature/core.test.ts', 'expect(true);') +
			added('src/unrelated/core.ts', 'export const separate = 2;')
	);

	expect(seedDiffGuide(run.inventory, null).groups.map((group) => group.hunks.map((hunk) => hunk.file))).toEqual([
		['lib/feature/core.py', 'src/feature/core.ts', 'tests/feature/core.test.ts'],
		['src/unrelated/core.ts']
	]);
});

test('pure moves and metadata-only renames carry deterministic notes and remain represented', () => {
	const run = newRun(
		'diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n' +
			'diff --git a/source.ts b/source.ts\n--- a/source.ts\n+++ b/source.ts\n@@ -1,3 +1,0 @@\n-const first = 1;\n-const second = 2;\n-return first + second;\n' +
			added('destination.ts', 'const first = 1;\nconst second = 2;\nreturn first + second;')
	);

	const hunks = seedDiffGuide(run.inventory, null).groups.flatMap((group) => group.hunks);

	expect(hunks).toHaveLength(3);
	expect(hunks.every((hunk) => !!hunk.note && !hunk.explanation)).toBe(true);
	expect(hunks.find((hunk) => hunk.file === 'new.ts')?.note).toBe('moved from old.ts');

	expect(hunks.filter((hunk) => hunk.file !== 'new.ts').map((hunk) => hunk.note)).toEqual([
		'moved from source.ts',
		'moved from source.ts'
	]);
});

test('an empty patch yields an empty guide', () => {
	expect(seedDiffGuide(newRun('').inventory, null)).toEqual({ source: 'deterministic', groups: [] });
});
