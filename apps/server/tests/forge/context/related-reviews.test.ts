import { expect, test } from 'bun:test';
import type { Finding, Review } from '@recoder/shared';
import { relatedReviewSources } from '../../../src/forge/context/related-reviews';
import { makeSource } from '../../../src/forge/context/sources';
import { db } from '../../../src/store';
import { testReview } from '../../helpers/review';

const finding = (file: string, title: string): Finding => ({
	id: title,
	file,
	line: 3,
	severity: 'warning',
	title,
	message: title
});

async function stored(
	repoId: string,
	prNumber: number,
	createdAt: string,
	findings: Finding[],
	status: Review['status'] = 'passed'
): Promise<void> {
	await db.reviews.set(testReview({ repoId, prNumber, createdAt, status, findings }));
}

const history = [
	makeSource({ kind: 'pr-history', ref: 'pr:#4', text: 'abc1234 Add pad (touched pad)' }),
	makeSource({ kind: 'pr-history', ref: 'pr:#7', text: 'def5678 Trim pad (touched pad)' }),
	makeSource({ kind: 'pr-history', ref: 'merge:0123456', text: 'merge' })
];

test('passes on the latest finished review before the cutoff of each PR history names, with only its findings on the changed files', async () => {
	const repoId = 'related-reviews-1';

	await stored(repoId, 4, '2026-01-01T00:00:00.000Z', [finding('a.ts', 'older review')]);

	await stored(repoId, 4, '2026-01-02T00:00:00.000Z', [
		finding('a.ts', 'pad drops the last char'),
		finding('b.ts', 'other file')
	]);

	await stored(repoId, 4, '2026-02-01T00:00:00.000Z', [finding('a.ts', 'after the cutoff')]);
	await stored(repoId, 7, '2026-01-03T00:00:00.000Z', [finding('a.ts', 'failed review')], 'failed');
	await stored(repoId, 9, '2026-01-03T00:00:00.000Z', [finding('a.ts', 'not in history')]);
	await stored('another-repo', 4, '2026-01-03T00:00:00.000Z', [finding('a.ts', 'another repo')]);

	const sources = await relatedReviewSources({ repoId, history, files: ['a.ts'], cutoff: '2026-01-15T00:00:00-06:00' });

	expect(sources.map((source) => [source.kind, source.ref, source.text])).toEqual([
		['related-review', 'review:#4', '- [warning] a.ts:3 pad drops the last char']
	]);
});

test('a review created after the cutoff never changes what an earlier run saw', async () => {
	const repoId = 'related-reviews-2';
	const input = { repoId, history, files: ['a.ts'], cutoff: '2026-01-15T00:00:00Z' };

	await stored(repoId, 7, '2026-01-10T00:00:00.000Z', [finding('a.ts', 'trim keeps a space')]);

	const first = await relatedReviewSources(input);

	await stored(repoId, 7, '2026-01-20T00:00:00.000Z', [finding('a.ts', 're-review after merge')]);

	expect(await relatedReviewSources(input)).toEqual(first);
	expect(first.map((source) => source.ref)).toEqual(['review:#7']);
});
