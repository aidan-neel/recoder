import { expect, test } from 'bun:test';
import type { Finding, ReviewFindingComment } from '@recoder/shared';
import { findingMarker } from '../../../src/forge/publish/render';
import { planFindingsReview, type PlanInput } from '../../../src/forge/publish/review-plan';

/** The pull request adds lines 1 to 5 of src/a.ts and docs/guide.md. */
const PULL_DIFF = ['src/a.ts', 'docs/guide.md']
	.map((path) =>
		[
			`diff --git a/${path} b/${path}`,
			`--- a/${path}`,
			`+++ b/${path}`,
			'@@ -0,0 +1,5 @@',
			...Array.from({ length: 5 }, (_, index) => `+line ${index + 1}`)
		].join('\n')
	)
	.join('\n');

function finding(id: string, overrides: Partial<Finding> = {}): Finding {
	return {
		id,
		fingerprint: `fp-${id}`,
		file: 'src/a.ts',
		line: 2,
		severity: 'warning',
		message: `Problem ${id}`,
		verification: { status: 'verified', reason: 'r', method: 'trace' },
		...overrides
	};
}

function plan(findings: Finding[], overrides: Partial<PlanInput> = {}) {
	return planFindingsReview({
		findings,
		pullDiff: PULL_DIFF,
		settings: { ignoredPaths: [], maxInlineComments: 25 },
		posted: new Map(),
		summarized: new Set(),
		reportedBefore: false,
		...overrides
	});
}

const ids = (findings: readonly { id: string }[]) => findings.map((item) => item.id);

test('a finding on a shown line goes inline and one without a shown line goes to the summary', () => {
	const result = plan([finding('on'), finding('off', { line: 40 }), finding('fileless', { line: undefined })]);

	expect(result.inline.map((item) => item.finding.id)).toEqual(['on']);
	expect(result.inline[0].target).toMatchObject({ path: 'src/a.ts', newLine: 2 });
	expect(ids(result.listed)).toEqual(['off', 'fileless']);
});

test('findings past the cap go to the summary, keeping the worst inline', () => {
	const result = plan([finding('low', { severity: 'info' }), finding('bad', { severity: 'error' })], {
		settings: { ignoredPaths: [], maxInlineComments: 1 }
	});

	expect(result.inline.map((item) => item.finding.id)).toEqual(['bad']);
	expect(ids(result.listed)).toEqual(['low']);
});

test('findings under an ignored path, unverified, dismissed or quieted are not posted', () => {
	const result = plan(
		[
			finding('doc', { file: 'docs/guide.md' }),
			finding('unproven', { verification: { status: 'unverified', reason: 'no run' } }),
			finding('dismissed', { decision: { state: 'dismissed', reason: 'wrong', decidedAt: 'now' } }),
			finding('quiet', { topic: { id: 'category:readability', label: 'Readability', quieted: true } }),
			finding('kept')
		],
		{ settings: { ignoredPaths: ['docs/**'], maxInlineComments: 25 } }
	);

	expect(result.inline.map((item) => item.finding.id)).toEqual(['kept']);
	expect(result.listed).toEqual([]);
});

test('a finding already commented on the pull request is carried with that comment, not posted again', () => {
	const known: ReviewFindingComment = { id: '91', url: 'https://forge/c/91', inline: true };
	const carried = finding('same');
	const result = plan([carried], { posted: new Map([[findingMarker(carried), known]]) });

	expect(result.inline).toEqual([]);
	expect(result.carried).toEqual({ same: known });
});

test('a finding carried from an earlier submitted review is not posted again; a new one is', () => {
	const carried = finding('old', { history: { firstSeenSha: 'aaa', state: 'carried' } });
	const fresh = finding('new', { history: { firstSeenSha: 'bbb', state: 'new' } });
	const result = plan([carried, fresh], { reportedBefore: true });

	expect(result.inline.map((item) => item.finding.id)).toEqual(['new']);
	expect(result.listed).toEqual([]);
});

test('without identity history every unposted finding is posted', () => {
	const result = plan([finding('a'), finding('b', { line: 3 })], { reportedBefore: true });

	expect(result.inline.map((item) => item.finding.id)).toEqual(['a', 'b']);
});
