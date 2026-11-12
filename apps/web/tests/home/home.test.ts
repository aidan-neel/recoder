import { expect, test } from 'bun:test';
import { repoLabels, type PullRequest, type Repo, type Review } from '@recoder/shared';
import {
	actionPrLabel,
	briefActions,
	briefSegments,
	chipLabels,
	fallbackBrief,
	type BriefPick
} from '../../src/lib/home/home';
import { matchesPr } from '../../src/lib/home/pr-filter';

function makeRepo(id: string, name: string, url: string, provider: Repo['provider'] = 'github'): Repo {
	return {
		id,
		name,
		url,
		provider,
		defaultBranch: 'main',
		createdAt: '2026-09-22T10:00:00Z',
		updatedAt: '2026-09-22T10:00:00Z'
	};
}

function makePr(number: number, additions: number, title = `Change ${number}`): PullRequest {
	return {
		number,
		title,
		url: `https://example.test/pull/${number}`,
		author: 'aidan',
		base: 'main',
		headRef: `feat-${number}`,
		headSha: `sha-${number}`,
		additions,
		deletions: 10,
		changedFiles: 3,
		createdAt: '2026-09-22T12:00:00Z'
	};
}

function makeHighReview(id: string, repoId: string, prNumber: number): Review {
	return {
		id,
		repoId,
		prNumber,
		headSha: `sha-${prNumber}`,
		status: 'passed',
		summary: 'Found a bug.',
		findings: [{ id: 'f1', file: 'src/index.ts', line: 10, severity: 'error', message: 'Broken auth check.' }],
		runs: ['run-1'],
		source: 'github',
		prTitle: null,
		prUrl: null,
		createdAt: '2026-09-22T13:00:00Z',
		updatedAt: '2026-09-22T13:00:00Z'
	};
}

function collidingApiItems(): BriefPick[] {
	const acme = makeRepo('r-acme', 'api', 'https://github.com/acme/api');
	const beta = makeRepo('r-beta', 'api', 'https://github.com/beta/api');

	return [
		{ repo: acme, pr: makePr(42, 30, 'Acme change') },
		{ repo: beta, pr: makePr(42, 400, 'Beta change'), review: makeHighReview('rev-beta', 'r-beta', 42) }
	];
}

test('two repositories with the same pull request number resolve each brief reference to its own repository', () => {
	const items = collidingApiItems();

	const singleSegments = briefSegments(
		'**Evening.** beta/api #42 has **one high finding**.',
		[{ repoId: 'r-beta', number: 42 }],
		items
	);

	const singlePrSeg = singleSegments.find((seg) => seg.kind === 'pr');

	expect(singlePrSeg?.kind === 'pr' ? singlePrSeg.item?.repo.id : null).toBe('r-beta');

	const dualSegments = briefSegments(
		'beta/api #42 has **one high finding**, while acme/api #42 is unreviewed.',
		[
			{ repoId: 'r-beta', number: 42 },
			{ repoId: 'r-acme', number: 42 }
		],
		items
	);

	const resolvedIds = dualSegments.flatMap((seg) => (seg.kind === 'pr' ? [seg.item?.repo.id] : []));

	expect(resolvedIds).toEqual(['r-beta', 'r-acme']);
});

test('brief actions select only the pull requests referenced by the brief instead of larger unmentioned pull requests', () => {
	const acme = makeRepo('r-acme', 'acme/api', 'https://github.com/acme/api');
	const beta = makeRepo('r-beta', 'beta/web', 'https://github.com/beta/web');

	const failedReview: Review = {
		...makeHighReview('rev-failed', 'r-acme', 12),
		status: 'failed',
		findings: []
	};

	const items: BriefPick[] = [
		{ repo: acme, pr: makePr(12, 40), review: failedReview },
		{ repo: beta, pr: makePr(99, 900) },
		{ repo: beta, pr: makePr(55, 120), review: makeHighReview('rev-55', 'r-beta', 55) }
	];

	const actions = briefActions(items, [{ repoId: 'r-acme', number: 12 }]);

	expect(actions.reviewPick?.pr.number).toBe(12);
	expect(actions.reviewPick?.repo.id).toBe('r-acme');
	expect(actions.openPick).toBeNull();
});

test('the local fallback brief emits repository-scoped references and labels when pull request numbers collide', () => {
	const acme = makeRepo('r-acme', 'api', 'https://github.com/acme/api');
	const beta = makeRepo('r-beta', 'api', 'https://github.com/beta/api');

	const items: BriefPick[] = [
		{ repo: acme, pr: makePr(42, 240) },
		{ repo: beta, pr: makePr(42, 80), review: makeHighReview('rev-beta', 'r-beta', 42) }
	];

	const labels = repoLabels([acme, beta]);
	const fallback = fallbackBrief(items, 'Aidan', 'morning', labels);
	const actions = briefActions(items, fallback.refs);
	const prSegments = briefSegments(fallback.text, fallback.refs, items, labels).filter((seg) => seg.kind === 'pr');

	expect(fallback.text).toContain('acme/api #42');
	expect(fallback.text).toContain('beta/api #42');
	expect(actions.reviewPick?.repo.id).toBe('r-acme');
	expect(actions.openPick?.repo.id).toBe('r-beta');
	expect(actionPrLabel(items[0], items, labels)).toBe('acme/api #42');
	expect(prSegments.map((seg) => (seg.kind === 'pr' ? seg.item?.repo.id : null))).toEqual(['r-acme', 'r-beta']);
});

test('filtering pull requests matches the repository owner derived from the repository URL', () => {
	const acme = makeRepo('r-acme', 'api', 'https://github.com/acme/api');
	const pr = makePr(18, 50, 'Fix timeout');

	expect(matchesPr(pr, acme, { query: 'acme/api', isUrl: false, pastedNumber: null, pastedRepo: undefined })).toBe(
		true
	);

	expect(matchesPr(pr, acme, { query: 'beta', isUrl: false, pastedNumber: null, pastedRepo: undefined })).toBe(false);
});

test('emphasized pull request references resolve inside strong text without shifting later pull request links', () => {
	const items = collidingApiItems();

	const segments = briefSegments(
		'**beta/api #42** is urgent; acme/api #42 can wait.',
		[
			{ repoId: 'r-beta', number: 42 },
			{ repoId: 'r-acme', number: 42 }
		],
		items
	);

	const prSegments = segments.filter((seg) => seg.kind === 'pr');

	expect(prSegments.map((seg) => (seg.kind === 'pr' ? seg.item?.repo.id : null))).toEqual(['r-beta', 'r-acme']);
});

test('two repositories with the same short name get their full labels on the filter chips, the rest stay short', () => {
	const acme = makeRepo('r-acme', 'acme/api', 'https://github.com/acme/api');
	const beta = makeRepo('r-beta', 'beta/api', 'https://github.com/beta/api');
	const web = makeRepo('r-web', 'acme/web', 'https://github.com/acme/web');
	const repos = [acme, beta, web];

	const chips = chipLabels(repos, repoLabels(repos));

	expect([...chips.values()]).toEqual(['acme/api', 'beta/api', 'web']);
});
