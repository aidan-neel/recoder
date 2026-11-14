import { describe, expect, test } from 'bun:test';

import type { GuidePart } from '../../src/lib/changes/types';
import { walkthroughSteps } from '../../src/lib/summary/walkthrough';

const AREA = ['source/core/Ky.ts', 'source/index.ts', 'readme.md'];

function part(id: string, title: string, paths = AREA, bugs = 1): GuidePart {
	return { id, title, reason: `Reason for ${id}.`, paths, bugs };
}

describe('walkthroughSteps', () => {
	test('the lens parts of one area become one step that names its files', () => {
		const steps = walkthroughSteps([
			part('unit-1/correctness', 'source/core and 6 more folders · Correctness'),
			part('unit-1/security', 'source/core and 6 more folders · Security'),
			part('unit-1/correctness-retry', 'source/core and 6 more folders · Correctness', [...AREA].reverse())
		]);

		expect(steps).toEqual([
			{
				id: 'unit-1/correctness',
				title: 'source/core and 6 more folders',
				note: 'Ky.ts, index.ts, readme.md',
				paths: AREA,
				bugs: 1
			}
		]);
	});

	test('areas with different files stay apart, in plan order', () => {
		const steps = walkthroughSteps([
			part('unit-1/correctness', 'apps/docs (3 files) · Correctness'),
			part('unit-2/correctness', 'packages/cli (2 files) · Correctness', ['packages/cli/a.ts', 'packages/cli/b.ts']),
			part('unit-1/security', 'apps/docs (3 files) · Security'),
			part('unit-2/security', 'packages/cli (2 files) · Security', ['packages/cli/a.ts', 'packages/cli/b.ts'])
		]);

		expect(steps.map((step) => [step.title, step.note])).toEqual([
			['apps/docs (3 files)', 'Ky.ts, index.ts, readme.md'],
			['packages/cli (2 files)', 'a.ts, b.ts']
		]);
	});

	test('files that share a name keep their folder in the step note', () => {
		const paths = ['source/core/dedupe.ts', 'test/dedupe.ts', 'readme.md'];

		const steps = walkthroughSteps([
			part('unit-1/correctness', 'source/core and 2 more folders · Correctness', paths),
			part('unit-1/security', 'source/core and 2 more folders · Security', paths)
		]);

		expect(steps.map((step) => step.note)).toEqual(['core/dedupe.ts, test/dedupe.ts, readme.md']);
	});

	test('a planned part keeps the title and reason the model wrote', () => {
		const steps = walkthroughSteps([
			part('geometry', 'Validate scale-normalized highlight geometry', ['src/utils.ts']),
			part('docs', 'Check the changelog · component claims', ['changelog/fix.md'])
		]);

		expect(steps.map((step) => [step.title, step.note])).toEqual([
			['Validate scale-normalized highlight geometry', 'Reason for geometry.'],
			['Check the changelog · component claims', 'Reason for docs.']
		]);
	});

	test('a title written before the server named the root says repository root instead of a dot', () => {
		const steps = walkthroughSteps([
			part('unit-1/correctness', '. and 6 more folders · Correctness'),
			part('unit-1/security', '. and 6 more folders · Security'),
			part('unit-2', '. (2 files)', ['a.ts', 'b.ts']),
			part('unit-3', '.github/workflows/ci.yml', ['.github/workflows/ci.yml'])
		]);

		expect(steps.map((step) => step.title)).toEqual([
			'repository root and 6 more folders',
			'repository root (2 files)',
			'.github/workflows/ci.yml'
		]);
	});
});
