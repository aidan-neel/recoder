import { loadRepoInventory } from '../repo-inventory/repo-inventory.js';
import type { ReviewRun } from './context.js';

/**
 * Lists every file at the PR head once, for the change model, obligations,
 * detectors and the reviewers' repo map. It never fails the review: without a
 * checkout, or when git cannot list the tree, `run.repo` stays null and those
 * stages work from the diff alone.
 */
export async function repoInventoryStage(run: ReviewRun): Promise<void> {
	const { input, events } = run;
	const checkoutPath = input.revision?.checkoutPath ?? input.sandboxPath;

	if (!checkoutPath) return;

	try {
		run.repo = await loadRepoInventory(checkoutPath, input.revision?.headSha || 'HEAD', run.controller.signal);
		events?.onLog?.(`Repo inventory: ${run.repo.files.length} files at ${run.repo.revision.slice(0, 7)}`);
	} catch (err) {
		run.repo = null;
		events?.onLog?.(`Repo inventory failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}
