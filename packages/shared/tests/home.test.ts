import { expect, test } from 'bun:test';
import { briefSnapshotKey, isHomeBriefResponse, latestReviews, repoLabels, repoOwner } from '../src/home';
import type { Review } from '../src/review';

function review(id: string, status: Review['status'], updatedAt: string): Review {
	return {
		id,
		repoId: 'r1',
		prNumber: 88,
		headSha: 'abc123',
		status,
		summary: null,
		findings: [],
		runs: [],
		source: 'stub',
		prTitle: null,
		prUrl: null,
		createdAt: updatedAt,
		updatedAt
	};
}

test('a real review outranks a newer empty draft', () => {
	const done = review('done', 'passed', '2026-09-22T09:00:00Z');
	const draft = review('draft', 'draft', '2026-09-22T18:00:00Z');

	expect(latestReviews([done, draft]).get('r1#88')?.id).toBe('done');
});

test('repository owner is derived from GitHub and GitLab URLs and omitted for local file URLs', () => {
	expect(repoOwner({ name: 'api', url: 'https://github.com/acme/api.git', provider: 'github' })).toBe('acme');

	expect(
		repoOwner({ name: 'api', url: 'https://gitlab.com/acme/platform/api/-/merge_requests', provider: 'gitlab' })
	).toBe('acme/platform');

	expect(repoOwner({ name: 'api', url: 'file:///work/acme/api', provider: 'local' })).toBeNull();
});

test('repositories sharing a short name or slug receive distinct labels from their URL, provider, or id', () => {
	const labels = repoLabels([
		{ id: 'r1', name: 'api', url: 'https://github.com/acme/api', provider: 'github' },
		{ id: 'r2', name: 'api', url: 'https://github.com/beta/api', provider: 'github' },
		{ id: 'r3', name: 'acme/web', url: 'https://github.com/acme/web', provider: 'github' },
		{ id: 'r4', name: 'acme/web', url: 'https://gitlab.com/acme/web', provider: 'gitlab' },
		{ id: 'r5', name: 'cli', url: 'file:///work/one/cli', provider: 'local' },
		{ id: 'r6', name: 'cli', url: 'file:///work/two/cli', provider: 'local' }
	]);

	expect(labels.get('r1')).toBe('acme/api');
	expect(labels.get('r2')).toBe('beta/api');
	expect(labels.get('r3')).toBe('acme/web (GitHub)');
	expect(labels.get('r4')).toBe('acme/web (GitLab)');
	expect(labels.get('r5')).toBe('one/cli (local)');
	expect(labels.get('r6')).toBe('two/cli (local)');
});

test('snapshot keys ignore pull request ordering and change when a head commit changes', () => {
	const a = { repoId: 'r1', number: 12, headSha: 'sha-1' };
	const b = { repoId: 'r2', number: 12, headSha: 'sha-2' };

	expect(briefSnapshotKey([b, a])).toBe(briefSnapshotKey([a, b]));
	expect(briefSnapshotKey([{ ...a, headSha: 'sha-3' }, b])).not.toBe(briefSnapshotKey([a, b]));
});

test('persisted brief validation rejects payloads missing structured references or snapshot keys', () => {
	expect(
		isHomeBriefResponse({
			text: '#12 needs review.',
			refs: [{ repoId: 'r1', number: 12 }],
			snapshot: 'r1#12@sha-1',
			generatedAt: '2026-09-22T19:30:00Z',
			model: 'orch'
		})
	).toBe(true);

	expect(isHomeBriefResponse({ text: '#12 needs review.', generatedAt: '2026-09-22T19:30:00Z', model: 'orch' })).toBe(
		false
	);
});
