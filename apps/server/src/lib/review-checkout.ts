import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Repo, Review } from '@recoder/shared';
import { env } from '../env.js';
import { db, reviewSandboxes } from '../store';
import { locateRepo, refspecFor } from './providers.js';
import { prepareSandbox, sandboxKey } from './sandbox.js';
import { tokenEnv } from './tokens.js';

/** The checkout could not be found or recreated. */
export class CheckoutError extends Error {
	constructor(message: string, readonly status: 409 | 502) {
		super(message);
	}
}

/** Where the pipeline puts a review's checkout (see `prepareSandbox`). */
export function reviewCheckoutPath(review: Review, repo: Repo): string {
	return join(env.RECODER_WORKDIR, 'repos', `${sandboxKey(locateRepo(repo.url).slug, review.prNumber)}__${review.id}`);
}

async function isCheckout(path: string): Promise<boolean> {
	return stat(join(path, '.git')).then(() => true, () => false);
}

/**
 * The review's checkout if it is on disk. The path registry is in memory, so
 * after a server restart this finds the checkout the pipeline left behind.
 */
export async function findReviewCheckout(review: Review): Promise<string | null> {
	const known = reviewSandboxes.get(review.id);
	if (known && await isCheckout(known)) return known;
	const repo = review.source === 'stub' ? null : db.repos.get(review.repoId);
	if (!repo) return null;
	const path = reviewCheckoutPath(review, repo);
	if (!await isCheckout(path)) return null;
	reviewSandboxes.set(review.id, path);
	return path;
}

const restoring = new Map<string, Promise<string>>();

/**
 * A checkout that git commands can run in: the existing one, or the PR head
 * fetched again (cloning if the directory is gone). Throws CheckoutError.
 */
export async function ensureReviewCheckout(review: Review): Promise<string> {
	if (review.source === 'stub') throw new CheckoutError('Stub reviews have no checkout.', 409);
	const found = await findReviewCheckout(review);
	if (found) return found;
	const repo = db.repos.get(review.repoId);
	if (!repo) throw new CheckoutError('The repository is no longer tracked.', 409);
	const pending = restoring.get(review.id);
	if (pending) return pending;
	const source = review.source;
	const { fetchRef, branch } = refspecFor(source, review.prNumber);
	const task = prepareSandbox({
		repoSlug: locateRepo(repo.url).slug,
		prNumber: review.prNumber,
		repoUrl: repo.url,
		fetchRef,
		branch,
		reviewId: review.id,
		provider: source,
		env: tokenEnv(source)
	})
		.then((sandbox) => {
			reviewSandboxes.set(review.id, sandbox.path);
			return sandbox.path;
		})
		.catch((err: unknown) => {
			throw new CheckoutError(`Could not restore the pull request checkout: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`, 502);
		})
		.finally(() => restoring.delete(review.id));
	restoring.set(review.id, task);
	return task;
}
