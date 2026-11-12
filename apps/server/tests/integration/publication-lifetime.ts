import { coordinator, initializeStorage, postgres, settingsOperation } from '../../src/storage/backend';
import { closePublicationStorage, initializePublication } from '../../src/storage/postgres-publication';
import { withLease } from '../../src/review/runtime/ownership';
import { setToken } from '../../src/forge/tokens';
import { settlePullComment, trackPullComment } from '../../src/forge/publish/pull-comment';
import { closeStore, db } from '../../src/store';
import { testReview } from '../helpers/review';

if (!postgres || !coordinator) throw new Error('The publication lifetime fixture needs its isolated database.');

await initializeStorage();
await initializePublication(postgres);
await settingsOperation(() => setToken('github', 'publication-fixture-token'));

const now = new Date().toISOString();
const reviewId = 'publication-fixture';

await db.repos.set({
	id: 'fixture-repo',
	name: 'acme/app',
	url: 'https://github.com/acme/app',
	provider: 'github',
	defaultBranch: 'main',
	createdAt: now,
	updatedAt: now
});

await db.reviews.set(
	testReview({
		id: reviewId,
		repoId: 'fixture-repo',
		prNumber: 7,
		status: 'running',
		pullComment: { state: 'posting', updatedAt: now }
	})
);

await coordinator.enqueue(reviewId);

const lease = await coordinator.claim('publication-fixture-owner');

if (!lease) throw new Error('Expected the publication fixture to claim its review.');

const creating = Promise.withResolvers<void>();
const release = Promise.withResolvers<void>();
let creates = 0;
let edits = 0;
const originalFetch = globalThis.fetch;

const fakeFetch = async (request: RequestInfo | URL, options?: RequestInit) => {
	const url = String(request);

	if (!url.startsWith('https://api.github.com/repos/acme/app/'))
		throw new Error('Unexpected external request in publication fixture.');
	if (new Headers(options?.headers).get('Authorization') !== 'Bearer publication-fixture-token')
		throw new Error('The publication lost its shared credentials context.');
	if (options?.method === 'POST') {
		creates++;
		creating.resolve();
		await release.promise;
	} else if (options?.method === 'PATCH') edits++;
	else return Response.json([]);

	return Response.json({ id: 901, html_url: 'https://github.com/acme/app/pull/7#issuecomment-901' });
};

globalThis.fetch = Object.assign(fakeFetch, { preconnect: originalFetch.preconnect });

try {
	await withLease(lease, async () => {
		await settingsOperation(() => trackPullComment(reviewId));
		await creating.promise;
		await db.reviews.update(reviewId, (review) => (review ? { ...review, status: 'passed' } : undefined));

		let settled = false;

		const final = settlePullComment(reviewId).then(() => {
			settled = true;
		});

		await Promise.resolve();
		if (settled) throw new Error('Final publication returned before its earlier remote create finished.');

		release.resolve();
		await final;

		const saved = await db.reviews.get(reviewId);

		if (creates !== 1 || edits !== 1 || saved?.pullComment?.state !== 'posted')
			throw new Error('The final comment was not written after the queued create.');
	});

	await coordinator.release(lease);
} finally {
	release.resolve();
	globalThis.fetch = originalFetch;
	await closePublicationStorage(postgres);
	await closeStore();
}
