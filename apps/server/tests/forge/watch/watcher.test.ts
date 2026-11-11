import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import type { Repo } from '@recoder/shared';
import { saveAutoReviewSettings } from '../../../src/forge/watch/settings';
import { autoReviewStatus, checkNow } from '../../../src/forge/watch/watcher';
import { reviewInstructions } from '../../../src/review/chat/review-chat';
import { getStoredSettings, setReviewOverrides } from '../../../src/review/session/review-settings';
import { db } from '../../../src/store';
import { restoreFetch, stubForge } from '../../helpers/forge-fetch';

const HOST = 'https://gitlab.acme.test/api/v4/projects/';
const originalSettings = getStoredSettings();

function repo(id: string, path: string): Repo {
	const at = new Date().toISOString();

	return {
		id,
		name: path,
		url: `https://gitlab.acme.test/${path}`,
		provider: 'gitlab',
		defaultBranch: 'main',
		createdAt: at,
		updatedAt: at
	};
}

let discussions: unknown[] = [];

beforeAll(async () => {
	process.env.GITLAB_TOKEN = 'glpat-test';
	await db.repos.set(repo('app', 'group/app'));
	await db.repos.set(repo('broken', 'group/broken'));
	saveAutoReviewSettings({ enabled: true, postResults: false });

	setReviewOverrides({
		baseUrl: 'http://watcher-model.test/v1',
		apiKey: 'test',
		models: [{ id: 'lead', label: 'Lead', model: 'lead' }],
		orchestratorModelId: 'lead',
		specialistModelId: 'lead'
	});

	stubForge(({ url }) => {
		if (url.startsWith(`${HOST}group%2Fbroken/`)) return [500, { message: 'boom' }];

		if (url.includes('/merge_requests?state=opened')) {
			const now = new Date().toISOString();

			return [200, [{ iid: 7, sha: 'abc', draft: false, created_at: '2026-01-01T00:00:00Z', updated_at: now }]];
		}

		if (url.includes('/merge_requests/7/discussions')) return [200, discussions];

		return [404, { message: 'not found' }];
	});
});

afterEach(() => {
	discussions = [];
});

afterAll(() => {
	restoreFetch();
	delete process.env.GITLAB_TOKEN;
	setReviewOverrides(originalSettings);
});

/** Wait for the background pipeline (it fails on the stubbed forge) so it can't outlive the stub. */
async function settled(reviewId: string): Promise<void> {
	for (let i = 0; i < 100 && ['queued', 'running'].includes((await db.reviews.get(reviewId))?.status ?? ''); i++) {
		await Bun.sleep(20);
	}
}

test('a round starts one review for a new mention and records a failing repository', async () => {
	await checkNow();

	const note = {
		id: 31,
		system: false,
		author: { username: 'ana' },
		body: '@recoder check the migration',
		created_at: new Date().toISOString()
	};

	discussions = [{ id: 'thread-1', notes: [{ id: 30, system: true, body: 'added 1 commit' }, note] }];
	await checkNow();
	await checkNow();

	const status = await autoReviewStatus();
	const reviews = (await db.reviews.list()).filter((review) => review.repoId === 'app');

	expect(reviews).toHaveLength(1);

	expect(reviews[0]).toMatchObject({
		trigger: 'auto',
		prNumber: 7,
		autoTrigger: { reason: 'mention', by: 'ana', noteId: '31', discussionId: 'thread-1' }
	});

	expect(await reviewInstructions(reviews[0]!.id, reviews[0]!.startedAt)).toBe('check the migration');
	expect(status.recent.map((event) => event.reviewId)).toEqual([reviews[0]!.id]);
	expect(status.errors.map((error) => error.repoId)).toEqual(['broken']);
	await settled(reviews[0]!.id);
});
