import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdaptiveReview, type ReviewProgressCheckpoint } from '../../../../src/review/pipeline/harness';
import { initReviewSettings, setReviewOverrides } from '../../../../src/review/session/review-settings';
import { addedFile, restoreAfterEach, stubModel, useTestModel } from '../harness-fixtures';

restoreAfterEach();

const savedMaxFiles = process.env.RECODER_REVIEW_MAX_FILES;
const savedMaxDiffChars = process.env.RECODER_REVIEW_MAX_DIFF_CHARS;

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-diff-limits-'));
});

afterEach(() => {
	if (savedMaxFiles === undefined) delete process.env.RECODER_REVIEW_MAX_FILES;
	else process.env.RECODER_REVIEW_MAX_FILES = savedMaxFiles;

	if (savedMaxDiffChars === undefined) delete process.env.RECODER_REVIEW_MAX_DIFF_CHARS;
	else process.env.RECODER_REVIEW_MAX_DIFF_CHARS = savedMaxDiffChars;
});

test('a pull request over maxFiles reviews only maxFiles files in priority order and records every omitted hunk', async () => {
	useTestModel();

	setReviewOverrides({
		baseUrl: 'http://model.test/v1',
		apiKey: 'test',
		models: [{ id: 'test', label: 'Test', model: 'test' }],
		maxFiles: 2,
		maxDiffChars: 200_000
	});

	stubModel([]);

	const diff = [
		addedFile('docs/guide.md', 5),
		addedFile('src/alpha.ts', 5),
		addedFile('tests/alpha.test.ts', 5),
		addedFile('src/beta.ts', 5)
	].join('');

	const result = await runAdaptiveReview({ diff, sandboxPath: null });

	const suppliedPaths = Object.values(result.context?.units ?? {}).flatMap((unit) =>
		unit.supplied.filter((place) => place.kind === 'diff').map((place) => place.path)
	);

	expect([...new Set(suppliedPaths)].sort()).toEqual(['src/alpha.ts', 'src/beta.ts']);

	expect(result.context?.omitted).toEqual([
		{
			kind: 'diff',
			path: 'tests/alpha.test.ts',
			startLine: 1,
			endLine: 5,
			reason: 'file-cap',
			why: 'exceeds maxFiles limit (2)'
		},
		{
			kind: 'diff',
			path: 'docs/guide.md',
			startLine: 1,
			endLine: 5,
			reason: 'file-cap',
			why: 'exceeds maxFiles limit (2)'
		}
	]);

	expect(result.coverage).toMatchObject({ reviewed: 2, excluded: 2, pending: 0, total: 4 });

	expect(result.coverageGaps.map((gap) => [gap.path, gap.state, gap.reason])).toEqual([
		['docs/guide.md', 'excluded', 'exceeds maxFiles limit (2)'],
		['tests/alpha.test.ts', 'excluded', 'exceeds maxFiles limit (2)']
	]);

	expect(result.summary).toContain('Reviewed within the configured diff limits (2 hunks omitted).');
});

test('a pull request over maxDiffChars drops trailing hunks and files and records each omission with reason diff-cap', async () => {
	useTestModel();

	setReviewOverrides({
		baseUrl: 'http://model.test/v1',
		apiKey: 'test',
		models: [{ id: 'test', label: 'Test', model: 'test' }],
		maxFiles: 10,
		maxDiffChars: 1_500
	});

	stubModel([]);

	const multiHunk = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,0 +1,10 @@
${Array.from({ length: 10 }, (_, index) => `+${String(index).padEnd(99, 'a')}`).join('\n')}
@@ -200,0 +211,10 @@
${Array.from({ length: 10 }, (_, index) => `+${String(index).padEnd(99, 'b')}`).join('\n')}
`;

	const diff = multiHunk + addedFile('src/b.ts', 10);
	const result = await runAdaptiveReview({ diff, sandboxPath: null });

	expect(result.context?.units['reviewer-1']?.supplied).toEqual([
		{ kind: 'diff', path: 'src/a.ts', startLine: 1, endLine: 10 }
	]);

	expect(result.context?.omitted).toEqual([
		{
			kind: 'diff',
			path: 'src/a.ts',
			startLine: 211,
			endLine: 220,
			reason: 'diff-cap',
			why: 'exceeds maxDiffChars limit (1500)'
		},
		{
			kind: 'diff',
			path: 'src/b.ts',
			startLine: 1,
			endLine: 10,
			reason: 'diff-cap',
			why: 'exceeds maxDiffChars limit (1500)'
		}
	]);

	expect(result.coverage).toMatchObject({ reviewed: 1, excluded: 2, pending: 0, total: 3 });
	expect(result.summary).toContain('Reviewed within the configured diff limits (2 hunks omitted).');
});

test('a single hunk larger than maxDiffChars clips its lines within the cap and records the clipped tail', async () => {
	useTestModel();

	setReviewOverrides({
		baseUrl: 'http://model.test/v1',
		apiKey: 'test',
		models: [{ id: 'test', label: 'Test', model: 'test' }],
		maxFiles: 10,
		maxDiffChars: 550
	});

	stubModel([]);

	const result = await runAdaptiveReview({ diff: addedFile('src/giant.ts', 20), sandboxPath: null });

	expect(result.context?.units['reviewer-1']?.supplied).toEqual([
		{ kind: 'diff', path: 'src/giant.ts', startLine: 1, endLine: 5 }
	]);

	expect(result.context?.omitted).toEqual([
		{
			kind: 'diff',
			path: 'src/giant.ts',
			startLine: 6,
			endLine: 20,
			reason: 'diff-cap',
			why: 'exceeds maxDiffChars limit (550)'
		}
	]);

	expect(result.coverage).toMatchObject({ reviewed: 1, excluded: 1, pending: 0, total: 2 });
	expect(result.summary).toContain('Reviewed within the configured diff limits (1 hunk omitted).');
});

test('RECODER_REVIEW_MAX_FILES and RECODER_REVIEW_MAX_DIFF_CHARS reach the pipeline when no stored override is set', async () => {
	process.env.RECODER_REVIEW_MAX_FILES = '1';
	process.env.RECODER_REVIEW_MAX_DIFF_CHARS = '450';
	initReviewSettings();
	useTestModel();
	stubModel([]);

	const diff = addedFile('src/first.ts', 10) + addedFile('src/second.ts', 5);
	const result = await runAdaptiveReview({ diff, sandboxPath: null });

	expect(result.context?.units['reviewer-1']?.supplied).toEqual([
		{ kind: 'diff', path: 'src/first.ts', startLine: 1, endLine: 4 }
	]);

	expect(result.context?.omitted?.map((entry) => [entry.path, entry.reason])).toEqual([
		['src/second.ts', 'file-cap'],
		['src/first.ts', 'diff-cap']
	]);
});

/** Runs `diff` until `reviewer-2` fails and returns the last checkpoint saved. */
async function checkpointBeforeResume(diff: string): Promise<ReviewProgressCheckpoint | null> {
	stubModel([], 'reviewer-2');

	let saved: ReviewProgressCheckpoint | null = null;

	await runAdaptiveReview(
		{ diff, sandboxPath: null },
		{
			onCheckpoint: (checkpoint) => {
				saved = checkpoint;
			}
		}
	);

	return saved;
}

test('a resumed checkpoint preserves the diff-limit omissions recorded at the start of the review', async () => {
	useTestModel();

	setReviewOverrides({
		baseUrl: 'http://model.test/v1',
		apiKey: 'test',
		models: [{ id: 'test', label: 'Test', model: 'test' }],
		maxFiles: 2,
		maxDiffChars: 100_000
	});

	const diff = addedFile('src/a.ts', 140) + addedFile('tests/b.ts', 140) + addedFile('docs/c.md', 10);
	const saved = await checkpointBeforeResume(diff);

	expect(saved?.received?.omitted).toEqual([
		{
			kind: 'diff',
			path: 'docs/c.md',
			startLine: 1,
			endLine: 10,
			reason: 'file-cap',
			why: 'exceeds maxFiles limit (2)'
		}
	]);

	stubModel([]);

	const resumed = await runAdaptiveReview({ diff, sandboxPath: null, resume: saved });

	expect(resumed.context?.omitted).toEqual(saved?.received?.omitted);
});
