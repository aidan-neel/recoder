import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { lastReviewCandidates } from '../../../src/cli/runs/last-review';
import { runFiles } from '../../../src/cli/runs/run-files';
import { report } from '../output/fixtures';
import { COMPLETE, runIdAt, storeRun, storeReview, useFreshDataDir } from './run-fixtures';

useFreshDataDir();

const HEAD_A = 'a'.repeat(40);

const BASE_A = 'b'.repeat(40);

const HEAD_B = 'c'.repeat(40);

const BASE_B = 'd'.repeat(40);

const candidate = (runId: ReturnType<typeof runIdAt>, headSha = HEAD_A, baseSha = BASE_A) => ({
	runId,
	headSha,
	baseSha
});

test('a complete review of a commit range is a candidate, newest first', async () => {
	await storeReview(runIdAt(1), { target: { headSha: HEAD_A, baseSha: BASE_A } });
	await storeReview(runIdAt(2), { target: { kind: 'pull', headSha: HEAD_B, baseSha: BASE_B } });

	expect(await lastReviewCandidates()).toEqual([candidate(runIdAt(2), HEAD_B, BASE_B), candidate(runIdAt(1))]);
});

test.each(['failed', 'cancelled'] as const)('a review that ended %s is not a candidate', async (outcome) => {
	await storeReview(runIdAt(1), { outcome, target: { headSha: HEAD_A, baseSha: BASE_A } });

	expect(await lastReviewCandidates()).toEqual([]);
});

test.each(['staged', 'uncommitted', 'diff'] as const)('a %s review is not a candidate', async (kind) => {
	await storeReview(runIdAt(1), { target: { kind, headSha: HEAD_A, baseSha: BASE_A } });

	expect(await lastReviewCandidates()).toEqual([]);
});

test('a review narrowed to some paths is not a candidate', async () => {
	await storeReview(runIdAt(1), {
		target: { headSha: HEAD_A, baseSha: BASE_A },
		settings: { include: ['src/**'] }
	});

	expect(await lastReviewCandidates()).toEqual([]);
});

test('a review that skipped some paths is not a candidate', async () => {
	await storeReview(runIdAt(1), {
		target: { headSha: HEAD_A, baseSha: BASE_A },
		settings: { exclude: ['**/*.test.ts'] }
	});

	expect(await lastReviewCandidates()).toEqual([]);
});

test('a review that ran only some lenses is not a candidate', async () => {
	await storeReview(runIdAt(1), {
		target: { headSha: HEAD_A, baseSha: BASE_A },
		settings: { lenses: ['correctness'] }
	});

	expect(await lastReviewCandidates()).toEqual([]);
});

test('a review that started at a commit the caller named is not a candidate', async () => {
	await storeReview(runIdAt(1), {
		target: { headSha: HEAD_A, baseSha: BASE_A, since: HEAD_B, sinceRunId: null }
	});

	expect(await lastReviewCandidates()).toEqual([]);
});

test('a report that names a start commit but no run is not a candidate', async () => {
	await storeReview(runIdAt(1), {
		target: { headSha: HEAD_A, baseSha: BASE_A, since: HEAD_B, sinceRunId: undefined }
	});

	expect(await lastReviewCandidates()).toEqual([]);
});

test('a review that continued an earlier review is a candidate', async () => {
	await storeReview(runIdAt(1), {
		target: { headSha: HEAD_A, baseSha: BASE_A, since: BASE_A, sinceRunId: runIdAt(0) }
	});

	expect(await lastReviewCandidates()).toEqual([candidate(runIdAt(1))]);
});

test('a report from before the start fields is read without error and is not a candidate', async () => {
	const runId = runIdAt(1);

	await storeRun(runId, COMPLETE);

	const old = JSON.parse(JSON.stringify(report()));

	delete old.target.since;
	delete old.target.sinceRunId;
	delete old.settings.include;
	delete old.settings.exclude;
	writeFileSync(runFiles(runId).report, JSON.stringify(old));

	expect(await lastReviewCandidates()).toEqual([]);
});

test('a run whose report cannot be read is skipped and the next older run still counts', async () => {
	await storeReview(runIdAt(1), { target: { headSha: HEAD_A, baseSha: BASE_A } });
	await storeRun(runIdAt(2), COMPLETE);
	writeFileSync(runFiles(runIdAt(2)).report, 'not json');

	expect(await lastReviewCandidates()).toEqual([candidate(runIdAt(1))]);
});

test('a run whose record cannot be read is skipped and the next older run still counts', async () => {
	await storeReview(runIdAt(1), { target: { headSha: HEAD_A, baseSha: BASE_A } });
	await storeRun(runIdAt(2), COMPLETE);
	writeFileSync(runFiles(runIdAt(2)).record, 'not json');

	expect(await lastReviewCandidates()).toEqual([candidate(runIdAt(1))]);
});

test('a report with no head or base commit is not a candidate', async () => {
	await storeReview(runIdAt(1), { target: { headSha: null, baseSha: null } });

	expect(await lastReviewCandidates()).toEqual([]);
});
