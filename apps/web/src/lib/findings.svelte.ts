/**
 * Review findings: model + local store.
 *
 * Findings anchor to a new-side line range within a file diff. The navigator
 * strip and thread panel read the same store.
 */

import type { Finding as BackendFinding, FindingSeverity as BackendSeverity } from '@recoder/shared';
import { findingTitle } from './finding-title';

export type FindingSeverity = 'high' | 'medium' | 'low' | 'info';
export type FindingStatus = 'open' | 'accepted' | 'dismissed';

/** On-demand fix suggestion state for one finding (client-side only). */
/** CI verification of a fix on its temporary branch. */
export interface FixVerify {
	status: 'pushing' | 'waiting' | 'running' | 'passed' | 'failed' | 'none' | 'error';
	branch?: string;
	sha?: string;
	checks?: import('@recoder/shared').PrCheck[];
	error?: string;
}

export interface FixSuggestion {
	status: 'loading' | 'ready' | 'error';
	summary?: string;
	patch?: string;
	/** Whether the patch applies cleanly to the review sandbox (null when unknown). */
	applies?: boolean | null;
	error?: string;
	/** Apply-to-PR state for a ready suggestion. */
	apply?: 'applying' | 'applied' | 'error';
	applyError?: string;
	sha?: string;
	branch?: string;
	verify?: FixVerify;
}

export const SEVERITIES: FindingSeverity[] = ['high', 'medium', 'low', 'info'];

/** Severity → marker color (diff bars, line numbers). */
export const SEVERITY_DOT: Record<FindingSeverity, string> = {
	high: 'var(--sev-high-icon)',
	medium: 'var(--sev-medium)',
	low: 'var(--sev-low)',
	info: 'var(--sev-info)'
};

export interface Finding {
	id: string;
	/** Legacy reference retained for existing links and searches. */
	code: string | null;
	title: string;
	severity: FindingSeverity;
	/** Review category, e.g. `perf`, `security`, `docs`. */
	category: string;
	/** Reviewer role that owns this finding, e.g. `security`. */
	agent: string;
	/** Model that produced this finding, when known. */
	model?: string | null;
	/** Fix attribution, set when the finding is accepted. */
	fixedBy?: string | null;
	body: string;
	file: string;
	/** New-side line range the finding refers to (inclusive). */
	startLine: number;
	endLine: number;
	/** Tool results the reviewer cited (`ev_…`), matched against the review's tool calls. */
	evidenceIds?: string[];
	assignmentId?: string;
	status: FindingStatus;
}

const FILE = 'src/rate-limit/limiter.ts';

function initialFindings(): Finding[] {
	return [
		{
			id: 'f-security-tenant',
			code: 'F-01',
			title: 'Shared buckets leak limits across tenants',
			severity: 'high',
			category: 'security',
			agent: 'security',
			body: "bucketFor shares one Map across tenants — two tenants behind one egress IP drain each other's budget.",
			file: FILE,
			startLine: 28,
			endLine: 31,
			status: 'open'
		},
		{
			id: 'f-perf-eviction',
			code: 'F-02',
			title: 'Unbounded bucket storage',
			severity: 'medium',
			category: 'perf',
			agent: 'perf',
			body: 'buckets Map has no eviction, so it grows once per key forever',
			file: FILE,
			startLine: 10,
			endLine: 12,
			status: 'open'
		},
		{
			id: 'f-correctness-clock',
			code: 'F-03',
			title: 'Refill ignores the injected clock',
			severity: 'medium',
			category: 'correctness',
			agent: 'correctness',
			body: 'refill() reads Date.now() directly, so the injected Clock is dead weight and tests cannot control time.',
			file: FILE,
			startLine: 20,
			endLine: 23,
			status: 'open'
		},
		{
			id: 'f-docs-allow',
			code: 'F-04',
			title: 'Outdated allow documentation',
			severity: 'low',
			category: 'docs',
			agent: 'docs',
			body: '`allow` moved into the class but the doc comment still reads like a free function.',
			file: FILE,
			startLine: 19,
			endLine: 19,
			status: 'open'
		},
		{
			id: 'f-style-capacity',
			code: 'F-05',
			title: 'Zero capacity silently blocks requests',
			severity: 'low',
			category: 'style',
			agent: 'patterns',
			body: 'Constructor takes capacity but never validates it — zero capacity bricks every bucket silently.',
			file: FILE,
			startLine: 13,
			endLine: 16,
			status: 'open'
		},
		{
			id: 'f-note-clock',
			code: 'F-06',
			title: 'Clock integration needs verification',
			severity: 'info',
			category: 'note',
			agent: 'docs',
			body: 'Clock is imported here — confirm refill timing moves onto it before removing the Date.now call.',
			file: FILE,
			startLine: 1,
			endLine: 1,
			status: 'open'
		}
	];
}

/** Map a backend finding (harness output) onto the local card/thread model. */
export function mapBackendFinding(f: BackendFinding, index: number): Finding {
	const severityMap: Record<BackendSeverity, FindingSeverity> = {
		error: 'high',
		warning: 'medium',
		info: 'info'
	};
	const match = /^\[([^\]]+)\]\s*/.exec(f.message);
	const category = match?.[1] ?? 'review';
	const body = match ? f.message.slice(match[0].length) : f.message;
	const line = f.line ?? 1;
	return {
		id: f.id,
		code: `F-${String(index + 1).padStart(2, '0')}`,
		title: findingTitle(body, f.title),
		severity: severityMap[f.severity],
		category,
		agent: f.agent ?? 'reviewer',
		model: f.model ?? null,
		body,
		file: f.file,
		startLine: line,
		endLine: f.endLine && f.endLine >= line ? f.endLine : line,
		evidenceIds: f.evidenceIds ?? [],
		assignmentId: f.assignmentId,
		status: 'open'
	};
}

const HIDE_INFO_KEY = 'recoder.hideInfo';

function loadHideInfo(): boolean {
	try {
		return localStorage.getItem(HIDE_INFO_KEY) === '1';
	} catch {
		return false;
	}
}

class FindingsStore {
	items = $state<Finding[]>(initialFindings());
	/** Fix suggestions by finding id (fetched on demand, never persisted). */
	suggestions = $state<Record<string, FixSuggestion>>({});
	activeId = $state<string | null>(null);
	/** Finding id currently hovered (card or code) — drives cross-highlighting. */
	hoveredId = $state<string | null>(null);
	/** While true (a selection drag is in progress), hovering never cross-highlights. */
	suppressHover = $state(false);
	/** When true, info findings are omitted from the tree, diff, and navigator. */
	hideInfo = $state(loadHideInfo());
	hiddenSeverities = $state<FindingSeverity[]>([]);

	isSeverityShown(severity: FindingSeverity): boolean {
		return !this.hiddenSeverities.includes(severity) && !(this.hideInfo && severity === 'info');
	}

	isShown(finding: Finding): boolean {
		return this.isSeverityShown(finding.severity);
	}

	toggleSeverity(severity: FindingSeverity): void {
		if (severity === 'info') { this.setHideInfo(!this.hideInfo); return; }
		this.hiddenSeverities = this.hiddenSeverities.includes(severity)
			? this.hiddenSeverities.filter((item) => item !== severity)
			: [...this.hiddenSeverities, severity];
		if (this.active && !this.isShown(this.active)) {
			this.activeId = null;
			this.hoveredId = null;
		}
	}

	/** Fixes the chat asked for (finding ids or codes, or 'all'); the Fix-all flow picks it up. */
	fixRequest = $state<{ key: string; ids: string[] | 'all' } | null>(null);

	/** Clear every severity filter (Info included). */
	showAllSeverities(): void {
		this.hiddenSeverities = [];
		if (this.hideInfo) this.setHideInfo(false);
	}

	forFile(file: string): Finding[] {
		return this.items.filter((f) => f.file === file && this.isShown(f));
	}

	setHideInfo(hide: boolean): void {
		this.hideInfo = hide;
		try {
			localStorage.setItem(HIDE_INFO_KEY, hide ? '1' : '0');
		} catch {
			// Preference just won't survive refresh.
		}
		const active = this.items.find((f) => f.id === this.activeId);
		if (active && !this.isShown(active)) {
			this.activeId = null;
			this.hoveredId = null;
		}
	}

	get active(): Finding | undefined {
		return this.items.find((f) => f.id === this.activeId);
	}

	discuss(id: string): void {
		this.activeId = id;
	}

	accept(id: string, fixedBy?: string): void {
		const finding = this.items.find((f) => f.id === id);
		if (finding) {
			finding.status = 'accepted';
			finding.fixedBy = fixedBy ?? null;
		}
	}

	dismiss(id: string): void {
		const finding = this.items.find((f) => f.id === id);
		if (finding) {
			finding.status = 'dismissed';
			if (this.activeId === id) this.activeId = null;
		}
	}

	reopen(id: string): void {
		const finding = this.items.find((f) => f.id === id);
		if (finding) finding.status = 'open';
	}

	suggesting(id: string): void {
		this.suggestions[id] = { status: 'loading' };
	}

	suggestReady(id: string, suggestion: { summary: string; patch: string; applies: boolean | null }): void {
		this.suggestions[id] = { status: 'ready', ...suggestion };
	}

	suggestError(id: string, error: string): void {
		this.suggestions[id] = { status: 'error', error };
	}

	setVerify(id: string, verify: FixVerify | undefined): void {
		const current = this.suggestions[id];
		if (current?.status === 'ready') this.suggestions[id] = { ...current, verify };
	}

	applyingFix(id: string): void {
		const current = this.suggestions[id];
		if (current?.status === 'ready') {
			this.suggestions[id] = { ...current, apply: 'applying', applyError: undefined };
		}
	}

	applyReady(id: string, result: { sha: string; branch: string }): void {
		const current = this.suggestions[id];
		if (current?.status === 'ready') {
			this.suggestions[id] = { ...current, apply: 'applied', ...result };
		}
	}

	applyFailed(id: string, error: string): void {
		const current = this.suggestions[id];
		if (current?.status === 'ready') {
			this.suggestions[id] = { ...current, apply: 'error', applyError: error };
		}
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
		this.items = initialFindings();
		this.hiddenSeverities = [];
		this.suggestions = {};
		this.activeId = null;
		this.hoveredId = null;
	}
}

export const findingsStore = new FindingsStore();
