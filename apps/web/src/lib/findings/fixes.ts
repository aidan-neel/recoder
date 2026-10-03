import { findingsStore, type Finding } from './findings.svelte';
import { errorToast } from '../shell/notify';
import { ApiError, serverApi } from '../api/server-api';
import { threadsStore } from './threads.svelte';

/** The finding fields the fix endpoints need. */
function toFixInput(finding: Finding) {
	return {
		file: finding.file,
		line: finding.startLine,
		endLine: finding.endLine,
		severity: finding.severity,
		message: finding.body
	};
}

/**
 * Ask the finding's reviewer for a patch. The result lands in `findingsStore.suggestions`. Out of usage,
 * the way out is settings, where another model gets picked.
 */
export async function suggestFix(finding: Finding, opts: { quiet?: boolean; queued?: boolean } = {}): Promise<void> {
	const reviewId = threadsStore.reviewId;

	if (!reviewId || (!opts.queued && findingsStore.suggestions[finding.id]?.status === 'loading')) return;
	findingsStore.suggesting(finding.id);

	try {
		const result = await serverApi.suggestFix(reviewId, { agent: finding.agent, finding: toFixInput(finding) });

		findingsStore.suggestReady(finding.id, {
			summary: result.summary,
			patch: result.patch,
			applies: result.applies
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Could not suggest a fix.';
		const action = e instanceof ApiError ? (e.usageLimit ? 'settings' : e.action) : undefined;

		findingsStore.suggestError(finding.id, message, action);
		if (!opts.quiet) errorToast('Could not suggest a fix', message, action);
	}
}

/** A finding with a suggested patch to read. */
export function hasReadyFix(finding: Finding): boolean {
	const s = findingsStore.suggestions[finding.id];

	return finding.status === 'open' && s?.status === 'ready' && !!s.patch;
}

/**
 * Suggest fixes / "fix these" from the chat: each finding's specialist writes a
 * patch in the background (three at a time). Each one shows on its finding for
 * the developer to read and apply themselves. One shared failure cause
 * (signed out, no model) gets a toast with its way out; mixed causes live on each finding.
 */
export async function fixFindings(findings: Finding[]): Promise<void> {
	const queue = findings.filter((f) => {
		const s = findingsStore.suggestions[f.id];

		return f.status === 'open' && s?.status !== 'loading' && !hasReadyFix(f);
	});

	for (const f of queue) findingsStore.suggesting(f.id);

	let next = 0;

	const worker = async () => {
		while (next < queue.length) await suggestFix(queue[next++], { quiet: true, queued: true });
	};

	await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));

	const errors = queue.flatMap((f) => {
		const s = findingsStore.suggestions[f.id];

		return s?.status === 'error' ? [s] : [];
	});

	const failed = errors.length;

	const shared =
		failed > 0 && errors.every((s) => s.error && s.error === errors[0].error && s.action === errors[0].action)
			? errors[0]
			: null;

	if (failed)
		errorToast(
			`${failed} ${failed === 1 ? 'fix' : 'fixes'} couldn't be written`,
			shared?.error ?? 'Retry from the finding.',
			shared?.action
		);
}
