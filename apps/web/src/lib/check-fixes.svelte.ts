import type { PrCheck } from '@recoder/shared';
import type { FixSuggestion } from './findings.svelte';
import { errorToast, undoToast } from './notify';
import { ApiError, serverApi } from './server-api';

/** Fixes for failing CI checks, by review and check id. Kept while the page is open. */
class CheckFixes {
	items = $state<Record<string, FixSuggestion & { name: string }>>({});

	key(reviewId: string, check: PrCheck): string {
		return `${reviewId}:${check.id}`;
	}

	get(reviewId: string, check: PrCheck): (FixSuggestion & { name: string }) | undefined {
		return this.items[this.key(reviewId, check)];
	}

	/** Read the check's log and have a model write a fix. */
	async suggest(reviewId: string, check: PrCheck): Promise<void> {
		if (!check.id) return;
		const key = this.key(reviewId, check);
		if (this.items[key]?.status === 'loading') return;
		this.items[key] = { status: 'loading', name: check.name };
		try {
			const result = await serverApi.suggestCheckFix(reviewId, { id: check.id, name: check.name });
			this.items[key] = { status: 'ready', name: check.name, summary: result.summary, patch: result.patch, edits: result.edits, applies: result.applies };
		} catch (e) {
			this.items[key] = { status: 'error', name: check.name, error: e instanceof Error ? e.message : 'Could not write a fix.', ...(e instanceof ApiError && e.action ? { action: e.action } : {}) };
		}
	}

	/** Push the fix to the PR branch as one commit. */
	async apply(reviewId: string, check: PrCheck): Promise<boolean> {
		const key = this.key(reviewId, check);
		const fix = this.items[key];
		if (fix?.status !== 'ready' || !fix.patch || fix.apply === 'applying') return false;
		this.items[key] = { ...fix, apply: 'applying', applyError: undefined };
		const file = fix.edits?.[0]?.file ?? /^\+\+\+ b\/(.+)$/m.exec(fix.patch)?.[1] ?? 'ci';
		try {
			await serverApi.applyFix(reviewId, {
				finding: { file, line: 1, endLine: 1, severity: 'error', message: `Fix the failing ${check.name} check` },
				summary: fix.summary ?? `Fix the failing ${check.name} check`,
				patch: fix.patch,
				edits: fix.edits
			});
			this.items[key] = { ...fix, apply: 'applied' };
			undoToast(`Fix for ${check.name} pushed`);
			return true;
		} catch (e) {
			const message = e instanceof Error ? e.message : 'Could not apply the fix.';
			this.items[key] = { ...fix, apply: 'error', applyError: message };
			errorToast('Could not apply the fix', message);
			return false;
		}
	}
}

export const checkFixes = new CheckFixes();
