import { findingsStore, type Finding, type FixVerify } from './findings.svelte';
import { errorToast, undoToast } from './notify';
import { ApiError, serverApi } from './server-api';
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
export async function suggestFix(finding: Finding, opts: { quiet?: boolean; queued?: boolean } = {}): Promise<void> {
	const reviewId = threadsStore.reviewId;
	if (!reviewId || (!opts.queued && findingsStore.suggestions[finding.id]?.status === 'loading')) return;
	findingsStore.suggesting(finding.id);
	try {
		const result = await serverApi.suggestFix(reviewId, { agent: finding.agent, finding: toFixInput(finding) });
		findingsStore.suggestReady(finding.id, { summary: result.summary, patch: result.patch, edits: result.edits, applies: result.applies });
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Could not suggest a fix.';
		const action = e instanceof ApiError ? e.action : undefined;
		findingsStore.suggestError(finding.id, message, action);
		if (!opts.quiet) errorToast('Could not suggest a fix', message, action);
	}
}

/** Push the ready patch to the PR head branch and mark the finding fixed. */
export async function applyFix(finding: Finding, opts: { quiet?: boolean } = {}): Promise<void> {
	const reviewId = threadsStore.reviewId;
	const suggestion = findingsStore.suggestions[finding.id];
	if (!reviewId || suggestion?.status !== 'ready' || !suggestion.patch || suggestion.apply === 'applying') return;
	findingsStore.applyingFix(finding.id);
	try {
		const result = await serverApi.applyFix(reviewId, {
			findingId: finding.id,
			agent: finding.agent,
			finding: toFixInput(finding),
			summary: suggestion.summary ?? finding.body,
			patch: suggestion.patch,
			edits: suggestion.edits
		});
		const verifyBranch = findingsStore.suggestions[finding.id]?.verify?.branch;
		findingsStore.applyReady(finding.id, { sha: result.sha, branch: result.branch });
		findingsStore.accept(finding.id, finding.agent, { sha: result.sha, branch: result.branch, summary: suggestion.summary ?? finding.body, at: new Date().toISOString(), agent: finding.agent });
		// The temporary CI branch has served its purpose.
		if (verifyBranch) void serverApi.deleteVerifyBranch(reviewId, verifyBranch).catch(() => undefined);
		// Pushed commits can't be reverted from here, so the toast has no Undo.
		if (!opts.quiet) undoToast(`Fix applied to ${finding.file.split('/').at(-1)}`);
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Could not apply the fix.';
		findingsStore.applyFailed(finding.id, message);
		if (!opts.quiet) errorToast('Could not apply the fix', message);
	}
}

/** A finding with a patch ready to push (not pushed yet). */
export function hasReadyFix(finding: Finding): boolean {
	const s = findingsStore.suggestions[finding.id];
	return finding.status === 'open' && s?.status === 'ready' && !!s.patch && s.apply !== 'applied';
}

/**
 * Fix all / "fix these" from the chat: each finding's specialist writes a patch
 * in the background (three at a time). Nothing is pushed; each fix is reviewed
 * on its finding, then applied there or with Apply all.
 */
export async function fixFindings(findings: Finding[]): Promise<void> {
	const queue = findings.filter((f) => {
		const s = findingsStore.suggestions[f.id];
		return f.status === 'open' && s?.status !== 'loading' && !hasReadyFix(f) && s?.apply !== 'applied';
	});
	for (const f of queue) findingsStore.suggesting(f.id);
	let next = 0;
	const worker = async () => {
		while (next < queue.length) await suggestFix(queue[next++], { quiet: true, queued: true });
	};
	await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
	const errors = queue.flatMap((f) => { const s = findingsStore.suggestions[f.id]; return s?.status === 'error' ? [s] : []; });
	const failed = errors.length;
	// One shared cause (signed out, no model) is worth saying, with its way out; mixed causes live on each finding.
	const shared = failed > 0 && errors.every((s) => s.error && s.error === errors[0].error && s.action === errors[0].action) ? errors[0] : null;
	if (failed) errorToast(`${failed} ${failed === 1 ? 'fix' : 'fixes'} couldn't be written`, shared?.error ?? 'Retry from the finding.', shared?.action);
}

/** Push every ready fix, one commit each, in order. */
export async function applyReadyFixes(findings: Finding[]): Promise<void> {
	const ready = findings.filter(hasReadyFix);
	let pushed = 0;
	for (const f of ready) {
		await applyFix(f, { quiet: true });
		if (findingsStore.suggestions[f.id]?.apply === 'applied') pushed += 1;
	}
	if (pushed) undoToast(`Applied ${pushed} ${pushed === 1 ? 'fix' : 'fixes'}`);
	if (pushed < ready.length) errorToast(`${ready.length - pushed} ${ready.length - pushed === 1 ? 'fix' : 'fixes'} couldn't be applied`, 'Retry from the finding.');
}

/* CI verification: push the ready fix to a temporary branch, then poll its checks. */
const verifyTimers = new Map<string, ReturnType<typeof setTimeout>>();
const POLL_MS = 8000;
/** No checks at all by then: the repo's CI probably doesn't run on branch pushes. */
const NO_CHECKS_AFTER_MS = 3 * 60_000;
const GIVE_UP_AFTER_MS = 45 * 60_000;

export async function verifyFix(finding: Finding): Promise<void> {
	const reviewId = threadsStore.reviewId;
	const suggestion = findingsStore.suggestions[finding.id];
	if (!reviewId || suggestion?.status !== 'ready' || !suggestion.patch) return;
	clearTimeout(verifyTimers.get(finding.id));
	findingsStore.setVerify(finding.id, { status: 'pushing' });
	let pushed: { branch: string; sha: string };
	try {
		pushed = await serverApi.verifyFix(reviewId, {
			key: finding.code ?? finding.id,
			finding: toFixInput(finding),
			summary: suggestion.summary ?? finding.body,
			patch: suggestion.patch,
			edits: suggestion.edits
		});
	} catch (e) {
		findingsStore.setVerify(finding.id, { status: 'error', error: e instanceof Error ? e.message : 'Could not push the fix branch.' });
		return;
	}
	const startedAt = Date.now();
	findingsStore.setVerify(finding.id, { status: 'waiting', ...pushed, checks: [] });
	const poll = async () => {
		const current = findingsStore.suggestions[finding.id]?.verify;
		if (current?.sha !== pushed.sha) return; // re-run or discarded
		try {
			const { checks } = await serverApi.getChecks(reviewId, pushed.sha);
			const elapsed = Date.now() - startedAt;
			const status: FixVerify['status'] = checks.length === 0
				? (elapsed > NO_CHECKS_AFTER_MS ? 'none' : 'waiting')
				: checks.some((c) => c.state === 'failed') && !checks.some((c) => c.state === 'pending' || c.state === 'running') ? 'failed'
				: checks.some((c) => c.state === 'pending' || c.state === 'running') ? 'running'
				: 'passed';
			findingsStore.setVerify(finding.id, { ...pushed, status, checks });
			if ((status === 'waiting' || status === 'running') && elapsed < GIVE_UP_AFTER_MS) verifyTimers.set(finding.id, setTimeout(poll, POLL_MS));
		} catch {
			verifyTimers.set(finding.id, setTimeout(poll, POLL_MS * 2));
		}
	};
	verifyTimers.set(finding.id, setTimeout(poll, 3000));
}

/** Delete a fix's verify branch from the remote (on apply, or when discarded). */
export async function discardVerify(finding: Finding): Promise<void> {
	const reviewId = threadsStore.reviewId;
	const branch = findingsStore.suggestions[finding.id]?.verify?.branch;
	clearTimeout(verifyTimers.get(finding.id));
	findingsStore.setVerify(finding.id, undefined);
	if (reviewId && branch) await serverApi.deleteVerifyBranch(reviewId, branch).catch(() => undefined);
}
