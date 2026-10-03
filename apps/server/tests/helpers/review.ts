import type { Review } from '@recoder/shared';

/** A passed GitHub review of PR 1 with no findings, stamped now; `overrides` replace any field. */
export function testReview(overrides: Partial<Review> = {}): Review {
	const now = new Date().toISOString();

	return {
		id: crypto.randomUUID(),
		repoId: 'test',
		prNumber: 1,
		headSha: 'test',
		status: 'passed',
		summary: null,
		findings: [],
		runs: [],
		source: 'github',
		prTitle: null,
		prUrl: null,
		createdAt: now,
		updatedAt: now,
		...overrides
	};
}
