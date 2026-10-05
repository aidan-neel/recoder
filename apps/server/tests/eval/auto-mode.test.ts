import { expect, test } from 'bun:test';
import { chooseMode } from '../../src/eval/auto-mode';
import type { HarnessRecord, TreeState } from '../../src/eval/harness-tree';

const SRC = 'apps/server/src/';
const tree = (commit: string): TreeState => ({ commit, files: {} });
const now = tree('now');

const record = (stages: string, reviewers: string | null): HarnessRecord => ({
	tree: tree(stages),
	reviewers: reviewers ? tree(reviewers) : null
});

/** Paths changed since a tree, by the commit it is on; git cannot compare a commit that is not listed. */
const changes = (byCommit: Record<string, string[]>) => (_cwd: string, before: TreeState) =>
	byCommit[before.commit] ?? null;

test('a report with no harness record, or no known reviewer tree, is a full run', () => {
	expect(chooseMode(undefined, now, '.').mode).toBe('full');
	expect(chooseMode(record('a', null), now, '.', changes({ a: [] })).mode).toBe('full');
});

test('outside a git checkout, or when git cannot compare, it is a full run', () => {
	expect(chooseMode(record('a', 'a'), null, '.').mode).toBe('full');
	expect(chooseMode(record('a', 'a'), now, '.', changes({})).mode).toBe('full');
});

test('a replay report keeps the reviewers it reused: a lens change since they ran needs a full run', () => {
	const paths = changes({
		stages: [`${SRC}review/pipeline/detectors/a.ts`],
		reviewers: [`${SRC}review/pipeline/lenses/b.ts`, `${SRC}review/pipeline/detectors/c.ts`]
	});

	expect(chooseMode(record('stages', 'reviewers'), now, '.', paths)).toMatchObject({
		mode: 'full',
		decidedBy: [`${SRC}review/pipeline/lenses/b.ts`]
	});
});

test('a stage change made before the report was written does not count again for a rescore', () => {
	const paths = changes({
		stages: [`${SRC}eval/benchmark-score.ts`],
		reviewers: [`${SRC}review/pipeline/detectors/c.ts`]
	});

	expect(chooseMode(record('stages', 'reviewers'), now, '.', paths).mode).toBe('rescore');
});
