/**
 * Review findings: the local store. The finding model lives in `finding-model.ts`.
 *
 * Findings anchor to a new-side line range within a file diff. The navigator
 * strip and thread panel read the same store.
 */

import { demoFindings } from './demo-findings';
import { syncDismissal } from './dismissals';
import type { Finding, FindingSeverity } from './finding-model';

export type { Finding, FindingSeverity } from './finding-model';
export { mapBackendFinding } from './finding-model';

/** On-demand fix suggestion state for one finding (client-side only). */
export interface FixSuggestion {
	status: 'loading' | 'ready' | 'error';
	summary?: string;
	patch?: string;
	/** Whether the patch applies cleanly to the review sandbox (null when unknown). */
	applies?: boolean | null;
	error?: string;
	/** What fixes a failed suggestion: signing in to ChatGPT, or setting up a model. */
	action?: import('@recoder/shared').FailureAction;
	/** The model's plan ran out while writing the fix. */
	usageLimit?: import('@recoder/shared').UsageLimit;
	/** Commands that passed with a checked patch applied (`bun run check`). */
	checks?: string[];
}

export const SEVERITIES: FindingSeverity[] = ['high', 'medium', 'low'];

/** Severity → marker color (diff bars, line numbers). */
export const SEVERITY_DOT: Record<FindingSeverity, string> = {
	high: 'var(--sev-high-icon)',
	medium: 'var(--sev-medium)',
	low: 'var(--sev-low)'
};

class FindingsStore {
	items = $state<Finding[]>(demoFindings());
	/** Fix suggestions by finding id (fetched on demand, never persisted). */
	suggestions = $state<Record<string, FixSuggestion>>({});
	activeId = $state<string | null>(null);
	/** Finding id currently hovered (card or code) — drives cross-highlighting. */
	hoveredId = $state<string | null>(null);
	/** While true (a selection drag is in progress), hovering never cross-highlights. */
	suppressHover = $state(false);
	hiddenSeverities = $state<FindingSeverity[]>([]);
	/** Findings view: list dismissed findings (dimmed, with Restore) below the open ones. */
	showDismissed = $state(false);

	isSeverityShown(severity: FindingSeverity): boolean {
		return !this.hiddenSeverities.includes(severity);
	}

	isShown(finding: Finding): boolean {
		return this.isSeverityShown(finding.severity);
	}

	toggleSeverity(severity: FindingSeverity): void {
		this.hiddenSeverities = this.hiddenSeverities.includes(severity)
			? this.hiddenSeverities.filter((item) => item !== severity)
			: [...this.hiddenSeverities, severity];

		if (this.active && !this.isShown(this.active)) {
			this.activeId = null;
			this.hoveredId = null;
		}
	}

	/** Fixes the chat asked for (finding ids or codes, or 'all'); the Fix-all flow picks it up. */
	/** Findings each chat reply asked to fix, by message id, so the reply shows their fixes. */
	fixBatches = $state<Record<string, string[]>>({});

	/** Clear every severity filter. */
	showAllSeverities(): void {
		this.hiddenSeverities = [];
	}

	forFile(file: string): Finding[] {
		return this.items.filter((f) => f.file === file && this.isShown(f));
	}

	get active(): Finding | undefined {
		return this.items.find((f) => f.id === this.activeId);
	}

	/** The fix to show on a finding: its checked patch, else a suggestion that's ready. */
	readyFix(finding: Finding): FixSuggestion | null {
		if (finding.patch) {
			return { status: 'ready', patch: finding.patch.diff, applies: true, checks: finding.patch.checks };
		}

		const suggestion = this.suggestions[finding.id];

		return suggestion?.status === 'ready' && suggestion.patch ? suggestion : null;
	}

	discuss(id: string): void {
		this.activeId = id;
	}

	dismiss(id: string): void {
		const finding = this.items.find((f) => f.id === id);

		if (finding) {
			finding.status = 'dismissed';
			if (this.activeId === id) this.activeId = null;
			syncDismissal(id, true);
		}
	}

	reopen(id: string): void {
		const finding = this.items.find((f) => f.id === id);

		if (!finding) return;

		const wasDismissed = finding.status === 'dismissed';

		finding.status = 'open';
		if (wasDismissed) syncDismissal(id, false);
	}

	suggesting(id: string): void {
		this.suggestions[id] = { status: 'loading' };
	}

	suggestReady(id: string, suggestion: { summary: string; patch: string; applies: boolean | null }): void {
		this.suggestions[id] = { status: 'ready', ...suggestion };
	}

	suggestError(id: string, error: string, action?: import('@recoder/shared').FailureAction): void {
		this.suggestions[id] = { status: 'error', error, ...(action ? { action } : {}) };
	}

	/** Merge remotely-fetched findings (backend reviews) into the local store. */
	syncRemote(findings: Finding[]): void {
		for (const f of findings) {
			if (!this.items.some((i) => i.id === f.id)) this.items.push(f);
		}
	}

	/** Replace items wholesale when switching to another session's findings. */
	replaceAll(findings: Finding[]): void {
		this.items = findings;
		this.hiddenSeverities = [];
		this.suggestions = {};
		this.activeId = null;
		this.hoveredId = null;
	}

	reset(): void {
		this.items = demoFindings();
		this.hiddenSeverities = [];
		this.suggestions = {};
		this.activeId = null;
		this.hoveredId = null;
	}
}

export const findingsStore = new FindingsStore();
