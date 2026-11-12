import { afterEach, expect, test } from 'bun:test';
import { handlePullHook, type PullHook } from '../../../src/forge/watch/webhook-event';
import { readWatchState } from '../../../src/forge/watch/cursor';
import { readAutoReviewSettings, saveAutoReviewSettings } from '../../../src/forge/watch/settings';
import { getStoredSettings, setReviewOverrides } from '../../../src/review/session/review-settings';
import { db } from '../../../src/store';

const originalSettings = getStoredSettings();
const originalAutoReview = readAutoReviewSettings();
const ids: string[] = [];

afterEach(async () => {
	setReviewOverrides(originalSettings);
	saveAutoReviewSettings(originalAutoReview);
	for (const id of ids.splice(0)) await db.repos.delete(id);
});

test('concurrent out-of-order hooks never move the persisted comment cursor backward', async () => {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	const url = `https://gitlab.example.test/group/${id}`;

	ids.push(id);
	await db.repos.set({ id, name: id, url, provider: 'gitlab', defaultBranch: 'main', createdAt: now, updatedAt: now });
	setReviewOverrides({});
	saveAutoReviewSettings({ enabled: true, onMention: true, mentionHandle: '@recoder' });

	const hook = (noteId: number): PullHook => ({
		repoUrls: [url],
		pull: { number: 1, headSha: 'head', draft: false, createdAt: now, updatedAt: now },
		event: {
			kind: 'mention',
			note: { id: noteId, stream: 'comment', author: 'ana', body: '@recoder review', createdAt: now }
		}
	});

	await Promise.all([handlePullHook(hook(91)), handlePullHook(hook(90))]);
	expect(readWatchState().repos[id].pulls['1'].noteIds.comment).toBe(91);
	expect(await handlePullHook(hook(91))).toMatchObject({ reviewCreated: false, reason: 'nothing to review' });
});
