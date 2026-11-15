import { describe, expect, test } from 'bun:test';
import {
	emptyTokenUsage,
	type Finding,
	type ModelCallRow,
	type Repo,
	type ReportPerson,
	type Review
} from '@recoder/shared';
import { pullStateKey, pullStates, recordPullState, type PullStateRecord } from '../../src/forge/pulls/pull-states';
import { findingFingerprint } from '../../src/forge/publish/render';
import { buildTelemetryReport, type TelemetryInput } from '../../src/telemetry/telemetry-report';

const NOW = new Date('2026-11-13T15:00:00.000Z');

const admin: ReportPerson = { accountId: 'owner', role: 'admin', provider: 'github', host: null, login: 'octocat' };

const mira: ReportPerson = {
	accountId: 'member:github::mira',
	role: 'member',
	provider: 'github',
	host: null,
	login: 'mira'
};

const idle: ReportPerson = {
	accountId: 'member:gitlab:git.acme.dev:tomas',
	role: 'member',
	provider: 'gitlab',
	host: 'git.acme.dev',
	login: 'tomas'
};

const coreRepo: Repo = {
	id: 'repo-core',
	name: 'recoder/recoder',
	url: 'https://github.com/recoder/recoder',
	provider: 'github',
	defaultBranch: 'main',
	createdAt: '2026-10-01T00:00:00.000Z',
	updatedAt: '2026-10-01T00:00:00.000Z'
};

const sdkRepo: Repo = {
	id: 'repo-sdk',
	name: 'recoder/sdk',
	url: 'https://gitlab.com/recoder/sdk',
	provider: 'gitlab',
	defaultBranch: 'main',
	createdAt: '2026-10-01T00:00:00.000Z',
	updatedAt: '2026-10-01T00:00:00.000Z'
};

function makeFinding(id: string, overrides: Partial<Finding> = {}): Finding {
	return {
		id,
		title: `Issue ${id}`,
		file: 'src/index.ts',
		line: 12,
		severity: 'error',
		message: `Bug ${id}`,
		verification: { status: 'verified', reason: 'Reproduced in test', method: 'run' },
		...overrides
	};
}

function makeReview(id: string, overrides: Partial<Review> = {}): Review {
	const at = overrides.startedAt ?? overrides.createdAt ?? '2026-11-12T10:00:00.000Z';

	return {
		id,
		repoId: coreRepo.id,
		prNumber: 1,
		headSha: 'abc1234',
		status: 'passed',
		summary: 'Reviewed.',
		findings: [],
		runs: [],
		source: 'github',
		prTitle: 'Fix race',
		prUrl: 'https://github.com/recoder/recoder/pull/1',
		startedAt: at,
		createdAt: at,
		updatedAt: at,
		...overrides
	};
}

function makeReviewCall(id: string, reviewId: string, inputTokens: number, outputTokens: number): ModelCallRow {
	return {
		id,
		at: '2026-11-12T10:01:00.000Z',
		person: 'owner',
		kind: 'review',
		ownerId: reviewId,
		provider: 'claude-code',
		model: 'claude-opus-5-5',
		usage: { ...emptyTokenUsage(), inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
		outcome: 'ok'
	};
}

function report(overrides: Partial<TelemetryInput> = {}) {
	return buildTelemetryReport({
		days: 7,
		now: NOW,
		reviews: [],
		repos: [coreRepo, sdkRepo],
		pullStates: [],
		calls: [],
		people: [admin, mira, idle],
		settings: { checkThreshold: 'warning', ignoredPaths: ['docs/**'] },
		...overrides
	});
}

describe('buildTelemetryReport', () => {
	test('creates zero-filled UTC days ending today and ignores reviews outside the window or not passed', () => {
		const built = report({
			reviews: [
				makeReview('old', { prNumber: 1, startedAt: '2026-11-06T23:59:59.000Z' }),
				makeReview('failed', { prNumber: 2, status: 'failed', startedAt: '2026-11-12T10:00:00.000Z' }),
				makeReview('in', { prNumber: 3, startedAt: '2026-11-07T00:00:00.000Z' })
			]
		});

		expect(built.from).toBe('2026-11-07');
		expect(built.to).toBe('2026-11-13');
		expect(built.daily).toHaveLength(7);
		expect(built.totals).toMatchObject({ prsReviewed: 1, reviews: 1, avgTokensPerReview: null });
	});

	test('deduplicates carried and rechecked findings across pushes and credits decisions and resolutions', () => {
		const carriedBug = makeFinding('f-bug', { severity: 'error' });
		const dismissedWarn = makeFinding('f-warn', { severity: 'warning' });
		const ignoredDoc = makeFinding('f-doc', { severity: 'error', file: 'docs/guide.md' });

		const quietedStyle = makeFinding('f-quiet', {
			severity: 'warning',
			topic: { id: 'smell:magic-value', label: 'Magic value', quieted: true }
		});

		const firstPush = makeReview('r-1', {
			prNumber: 10,
			trigger: 'webhook',
			startedAt: '2026-11-10T09:00:00.000Z',
			findings: [carriedBug, dismissedWarn, ignoredDoc, quietedStyle],
			findingComments: { 'f-bug': { id: 'c1', url: 'https://test/c1', inline: true } }
		});

		const secondPush = makeReview('r-2', {
			prNumber: 10,
			startedBy: mira.accountId,
			startedAt: '2026-11-11T14:00:00.000Z',
			findings: [
				{
					...carriedBug,
					history: { firstSeenSha: 'abc1234', state: 'carried' },
					decision: {
						state: 'accepted',
						decidedAt: '2026-11-11T15:00:00.000Z',
						decidedBy: mira.accountId
					}
				},
				{
					...dismissedWarn,
					history: { firstSeenSha: 'abc1234', state: 'rechecked' },
					decision: {
						state: 'dismissed',
						reason: 'not-worth-fixing',
						decidedAt: '2026-11-11T15:05:00.000Z',
						decidedBy: mira.accountId
					}
				},
				{ ...ignoredDoc, history: { firstSeenSha: 'abc1234', state: 'carried' } }
			],
			resolved: [{ finding: makeFinding('f-fixed'), reason: 'Tests pass', resolvedAtSha: 'def5678' }],
			findingsReview: { state: 'posted', updatedAt: '2026-11-11T14:05:00.000Z' },
			summarizedFindings: [findingFingerprint(ignoredDoc)]
		});

		const built = report({ reviews: [firstPush, secondPush] });

		expect(built.totals).toMatchObject({
			prsReviewed: 1,
			reviews: 2,
			autoReviews: 1,
			findings: 3,
			highFindings: 2,
			mediumFindings: 1,
			lowFindings: 0,
			findingsAccepted: 1,
			findingsDismissed: 1,
			/** Only `f-bug` blocks: `f-warn` was dismissed and `f-doc` is in `ignoredPaths`. */
			findingsBlocking: 1,
			findingsResolved: 1,
			findingsPosted: 2
		});

		const octocatRow = built.people.find((person) => person.accountId === admin.accountId);
		const miraRow = built.people.find((person) => person.accountId === mira.accountId);

		expect(octocatRow).toMatchObject({ prsReviewed: 1, reviews: 1, autoReviews: 1, findings: 3, findingsBlocking: 1 });

		expect(miraRow).toMatchObject({
			prsReviewed: 1,
			reviews: 1,
			findingsAccepted: 1,
			findingsDismissed: 1,
			findingsResolved: 1,
			share: 0.5
		});
	});

	test('credits auto-reviewed PRs to members who triage their findings and tracks merges and avg tokens', () => {
		const autoReview = makeReview('r-auto', {
			repoId: sdkRepo.id,
			prNumber: 42,
			trigger: 'auto',
			startedAt: '2026-11-11T08:00:00.000Z',
			findings: [
				makeFinding('f-1', {
					decision: {
						state: 'accepted',
						decidedAt: '2026-11-11T09:30:00.000Z',
						decidedBy: mira.accountId
					}
				})
			]
		});

		const manualReview = makeReview('r-manual', {
			repoId: coreRepo.id,
			prNumber: 43,
			startedBy: mira.accountId,
			startedAt: '2026-11-12T11:00:00.000Z'
		});

		const states: PullStateRecord[] = [
			{
				id: pullStateKey(sdkRepo.id, 42),
				repoId: sdkRepo.id,
				number: 42,
				state: 'merged',
				checkedAt: '2026-11-13T10:00:00.000Z',
				mergedAt: '2026-11-12T16:00:00.000Z'
			},
			{
				/** Never reviewed and not merged via Recoder: ignored so unreviewed forge PRs do not inflate merges. */
				id: pullStateKey(coreRepo.id, 99),
				repoId: coreRepo.id,
				number: 99,
				state: 'merged',
				checkedAt: '2026-11-12T16:00:00.000Z'
			}
		];

		const calls: ModelCallRow[] = [
			makeReviewCall('c-1', 'r-auto', 150_000, 50_000),
			makeReviewCall('c-2', 'r-auto', 90_000, 10_000),
			makeReviewCall('c-3', 'r-manual', 80_000, 20_000)
		];

		const built = report({ reviews: [autoReview, manualReview], pullStates: states, calls });

		expect(built.totals).toMatchObject({
			prsReviewed: 2,
			prsMerged: 1,
			reviews: 2,
			reviewTokens: 400_000,
			avgTokensPerReview: 200_000
		});

		const miraRow = built.people.find((person) => person.accountId === mira.accountId);
		const octocatRow = built.people.find((person) => person.accountId === admin.accountId);

		expect(miraRow).toMatchObject({
			prsReviewed: 2,
			prsMerged: 1,
			findingsAccepted: 1,
			reviewTokens: 100_000,
			avgTokensPerReview: 100_000
		});

		expect(octocatRow).toMatchObject({
			prsReviewed: 1,
			prsMerged: 1,
			reviewTokens: 300_000,
			avgTokensPerReview: 300_000
		});
	});

	test('synthesizes removed member accounts from their accountId and preserves mergedAt in recordPullState', async () => {
		const ghostId = 'member:github::ghost';

		const built = report({
			reviews: [makeReview('r-ghost', { prNumber: 7, startedBy: ghostId, startedAt: '2026-11-12T10:00:00.000Z' })]
		});

		expect(built.people.find((person) => person.accountId === ghostId)).toMatchObject({
			login: 'ghost',
			provider: 'github',
			prsReviewed: 1
		});

		const key = pullStateKey('telemetry-test-repo', 77);

		await pullStates.delete(key);
		await recordPullState('telemetry-test-repo', 77, 'merged', mira.accountId);

		const first = await pullStates.get(key);

		expect(first).toMatchObject({ state: 'merged', mergedBy: mira.accountId });
		expect(first?.mergedAt).toBeDefined();

		await recordPullState('telemetry-test-repo', 77, 'merged');

		const second = await pullStates.get(key);

		expect(second?.mergedAt).toBe(first?.mergedAt);
		expect(second?.mergedBy).toBe(mira.accountId);
		await pullStates.delete(key);
	});
});
