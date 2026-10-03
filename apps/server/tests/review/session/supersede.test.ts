import { afterEach, expect, test } from 'bun:test';
import type { Review } from '@recoder/shared';
import { closeReviewControl, openReviewControl } from '../../../src/review/session/review-control';
import { supersedeWebhookReviews } from '../../../src/review/session/supersede';
import { db } from '../../../src/store';

const ids: string[] = [];

afterEach(() => {
	for (const id of ids.splice(0)) db.reviews.delete(id);
});

/** A running review stored with its live control. */
function running(prNumber: number, trigger?: Review['trigger']) {
	const at = new Date().toISOString();
	const id = crypto.randomUUID();

	ids.push(id);

	db.reviews.set({
		id,
		repoId: 'repo',
		prNumber,
		headSha: 'old',
		status: 'running',
		summary: null,
		findings: [],
		runs: [],
		source: 'github',
		prTitle: null,
		prUrl: null,
		...(trigger ? { trigger } : {}),
		createdAt: at,
		updatedAt: at
	});

	const control = openReviewControl(id);

	return { signal: control.abort.signal, close: () => closeReviewControl(id, control) };
}

test("a new push cancels only that PR's in-flight webhook review", () => {
	const stale = running(7, 'webhook');
	const manual = running(7);
	const otherPr = running(8, 'webhook');

	supersedeWebhookReviews('repo', 7);

	expect((stale.signal.reason as Error).message).toBe('Superseded by a newer push.');
	expect(manual.signal.aborted).toBe(false);
	expect(otherPr.signal.aborted).toBe(false);

	for (const review of [stale, manual, otherPr]) review.close();
});
