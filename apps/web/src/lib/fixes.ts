import { findingsStore, type Finding } from './findings.svelte';
import { errorToast, undoToast } from './notify';
import { serverApi } from './server-api';
import { threadsStore } from './threads.svelte';

/** The finding fields the fix endpoints need. */
export function toFixInput(finding: Finding) {
	return {
		file: finding.file,
		line: finding.startLine,
		endLine: finding.endLine,
		severity: finding.severity,
		message: finding.body
	};
}

/** Ask the finding's reviewer for a patch. The result lands in `findingsStore.suggestions`. */
export async function suggestFix(finding: Finding): Promise<void> {
	const reviewId = threadsStore.reviewId;
	if (!reviewId || findingsStore.suggestions[finding.id]?.status === 'loading') return;
	findingsStore.suggesting(finding.id);
	try {
		const result = await serverApi.suggestFix(reviewId, { agent: finding.agent, finding: toFixInput(finding) });
		findingsStore.suggestReady(finding.id, { summary: result.summary, patch: result.patch, applies: result.applies });
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Could not suggest a fix.';
		findingsStore.suggestError(finding.id, message);
		errorToast('Could not suggest a fix', message);
	}
}

/** Push the ready patch to the PR head branch and mark the finding fixed. */
export async function applyFix(finding: Finding): Promise<void> {
	const reviewId = threadsStore.reviewId;
	const suggestion = findingsStore.suggestions[finding.id];
	if (!reviewId || suggestion?.status !== 'ready' || !suggestion.patch || suggestion.apply === 'applying') return;
	findingsStore.applyingFix(finding.id);
	try {
		const result = await serverApi.applyFix(reviewId, {
			finding: toFixInput(finding),
			summary: suggestion.summary ?? finding.body,
			patch: suggestion.patch
		});
		findingsStore.applyReady(finding.id, { sha: result.sha, branch: result.branch });
		findingsStore.accept(finding.id, finding.agent);
		// Pushed commits can't be reverted from here, so the toast has no Undo.
		undoToast(`Fix applied to ${finding.file.split('/').at(-1)}`);
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Could not apply the fix.';
		findingsStore.applyFailed(finding.id, message);
		errorToast('Could not apply the fix', message);
	}
}
