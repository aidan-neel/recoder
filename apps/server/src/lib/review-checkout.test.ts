import { afterEach, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Repo, Review } from '@recoder/shared';
import { db, reviewSandboxes } from '../store';
import { CheckoutError, ensureReviewCheckout, findReviewCheckout, reviewCheckoutPath } from './review-checkout';

const cleanup: (() => Promise<void> | void)[] = [];

function fixture(source: Review['source'] = 'github'): { review: Review; repo: Repo } {
	const now = new Date().toISOString();
	const repo = db.repos.set({ id: crypto.randomUUID(), name: 'acme/app', url: 'https://github.com/acme/app', provider: 'github', defaultBranch: 'main', createdAt: now, updatedAt: now });
	const review = db.reviews.set({ id: crypto.randomUUID(), repoId: repo.id, prNumber: 7, headSha: 'head', status: 'passed', summary: null, findings: [], runs: [], source, prTitle: null, prUrl: null, createdAt: now, updatedAt: now });
	cleanup.push(() => { db.reviews.delete(review.id); db.repos.delete(repo.id); reviewSandboxes.delete(review.id); });
	return { review, repo };
}

afterEach(async () => {
	for (const fn of cleanup.splice(0)) await fn();
});

test('finds the checkout the pipeline left on disk after the in-memory registry is lost', async () => {
	const { review, repo } = fixture();
	const path = reviewCheckoutPath(review, repo);
	expect(path).toContain(`acme__app__pr-7__${review.id}`);
	await mkdir(join(path, '.git'), { recursive: true });
	cleanup.push(() => rm(path, { recursive: true, force: true }));

	reviewSandboxes.delete(review.id); // a server restart
	expect(await findReviewCheckout(review)).toBe(path);
	expect(reviewSandboxes.get(review.id)).toBe(path);
	expect(await ensureReviewCheckout(review)).toBe(path);
});

test('a registered path whose directory is gone is not returned', async () => {
	const { review, repo } = fixture();
	reviewSandboxes.set(review.id, join(reviewCheckoutPath(review, repo), 'missing'));
	expect(await findReviewCheckout(review)).toBeNull();
});

test('stub reviews have no checkout', async () => {
	const { review } = fixture('stub');
	expect(await findReviewCheckout(review)).toBeNull();
	await expect(ensureReviewCheckout(review)).rejects.toBeInstanceOf(CheckoutError);
});
