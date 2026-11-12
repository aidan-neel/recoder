import { rm } from 'node:fs/promises';
import { parseUnifiedDiff } from '@recoder/shared';
import type { ReviewRevision } from '../../evidence/evidence.js';
import { BaseTree } from '../../sandbox/base-tree.js';
import { removeOverlayDirs } from '../../sandbox/overlay.js';
import { revisionDiff } from '../../sandbox/sandbox.js';
import { sandboxLayout } from '../../sandbox/sandbox-layout.js';
import { removeLayers } from '../../sandbox/workspace-setup.js';
import { notReadyError, usageError } from '../exit.js';
import type { ReviewStart } from '../review/options.js';
import { assertNotCancelled } from './git.js';
import type { ResolvedTarget, TargetRequest } from './resolve-target.js';
import { isScoped, scopePathspecs } from './scope.js';

/** What the forge says about a pull request; null for a local change. */
interface PullDetails {
	title: string;
	body: string | null;
	url: string;
}

/** A change whose head is checked out in a throwaway folder, ready to diff and hand to the pipeline. */
export interface CheckedOutChange {
	request: TargetRequest;
	revision: ReviewRevision;
	/** The head as the caller named it, or what it stands for (`staged changes`). */
	headName: string;
	pull: PullDetails | null;
	/** Where the review of the commits begins, resolved. */
	start: ReviewStart;
}

/** The diff of the change within the request's scope, with the checkout and its cleanup; an empty diff is refused. */
export async function checkedOutTarget(change: CheckedOutChange): Promise<ResolvedTarget> {
	const { request, revision } = change;
	const diff = await scopedDiff(change);

	if (!diff.trim()) throw emptyChange(change);

	return {
		diff,
		sandboxPath: revision.checkoutPath,
		revision,
		title: change.pull?.title ?? null,
		body: change.pull?.body ?? null,
		report: {
			kind: request.target.kind,
			repoPath: request.repoPath,
			base: revision.targetRef,
			head: change.headName,
			baseSha: revision.targetSha,
			mergeBaseSha: revision.mergeBaseSha,
			headSha: revision.headSha,
			since: change.start.since,
			sinceRunId: change.start.sinceRunId,
			url: change.pull?.url ?? null,
			changedFiles: parseUnifiedDiff(diff).length
		},
		dispose: disposeOnce(revision)
	};
}

/** Runs `build`; when it throws, removes `checkoutPath` first, so a failed resolve leaves nothing on disk. */
export async function removedOnFailure<T>(checkoutPath: string, build: () => Promise<T>): Promise<T> {
	try {
		return await build();
	} catch (err) {
		await removeCheckout(checkoutPath);
		throw err;
	}
}

async function scopedDiff(change: CheckedOutChange): Promise<string> {
	const { signal, scope } = change.request;

	try {
		return await revisionDiff(change.revision, { pathspecs: scopePathspecs(scope), signal });
	} catch (err) {
		assertNotCancelled(signal);
		throw notReadyError(`Could not diff the checkout: ${err instanceof Error ? err.message : String(err)}`);
	}
}

function emptyChange(change: CheckedOutChange): Error {
	const ends = `${change.revision.targetRef} and ${change.headName}`;
	const within = isScoped(change.request.scope) ? ' within --include and --exclude' : '';

	return usageError(`Nothing to review: no difference between ${ends}${within}.`);
}

/** A cleanup that runs once, however often it is called. */
function disposeOnce(revision: ReviewRevision): () => Promise<void> {
	let removal: Promise<void> | null = null;

	return () => {
		removal ??= removeCheckoutAndLeftovers(revision);

		return removal;
	};
}

/**
 * Removes the checkout and what the sandbox keeps under its name: the cache
 * folder, the overlay layers and the merge-base tree with its index. A
 * review's `cleanup` leaves the cache folder, and an aborted one skips
 * cleanup, while each run's checkout has a new name, so nothing would ever
 * reuse them. Installs and stores shared by scope live in the shared folder
 * and stay. The cache folder may hold read-only trees, so it goes the overlay
 * way; the checkout does not, because its object files may be hard links
 * into the user's repository, and opening up their permissions would change
 * the user's files too. The cache folder goes before the base tree inside it,
 * so a read-only tree is opened up first and the base step only has its index
 * left to remove. Throws one error naming every path left behind.
 */
async function removeCheckoutAndLeftovers(revision: ReviewRevision): Promise<void> {
	const layout = sandboxLayout(revision.checkoutPath);
	const baseTree = new BaseTree(layout, revision.headSha, revision.mergeBaseSha);

	const steps: RemovalStep[] = [
		{ path: layout.layersDir, remove: () => removeLayers(layout) },
		{ path: layout.cacheDir, remove: () => removeOverlayDirs(layout.cacheDir) },
		{ path: baseTree.root, remove: () => baseTree.remove() },
		{ path: revision.checkoutPath, remove: () => removeCheckout(revision.checkoutPath) }
	];

	const failures = await runEveryStep(steps);

	if (failures.length) throw new Error(`Could not remove ${failures.join('; ')}`);
}

/** One thing `dispose` removes, named by the path it removes. */
interface RemovalStep {
	path: string;
	remove: () => Promise<void>;
}

/**
 * Runs every step in order, even after one fails, so one stuck folder never
 * leaves the checkout behind. Returns each failed path with why it failed.
 */
async function runEveryStep(steps: RemovalStep[]): Promise<string[]> {
	const failures: string[] = [];

	for (const step of steps) {
		await step.remove().catch((err: unknown) => {
			failures.push(`${step.path} (${err instanceof Error ? err.message : String(err)})`);
		});
	}

	return failures;
}

function removeCheckout(checkoutPath: string): Promise<void> {
	return rm(checkoutPath, { recursive: true, force: true });
}
