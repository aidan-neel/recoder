/**
 * Review findings: model + local store.
 *
 * Findings anchor to a new-side line range within a file diff. The navigator
 * strip and thread panel read the same store.
 */

import type { Finding as BackendFinding, FindingSeverity as BackendSeverity } from '@recoder/shared';

export type FindingSeverity = 'high' | 'medium' | 'low' | 'info';
export type FindingStatus = 'open' | 'accepted' | 'dismissed';

export const SEVERITIES: FindingSeverity[] = ['high', 'medium', 'low', 'info'];

/** Severity → marker dot color. */
export const SEVERITY_DOT: Record<FindingSeverity, string> = {
	high: '#e0655f',
	medium: '#d9a13b',
	low: '#5b8cff',
	info: '#8a8f98'
};

export interface Finding {
	id: string;
	/** Short code shown in threads, e.g. `F-01`. */
	code: string | null;
	severity: FindingSeverity;
	/** Review category, e.g. `perf`, `security`, `docs`. */
	category: string;
	/** Reviewing agent / model, e.g. `qwen2.5-coder-32b`. */
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
	status: FindingStatus;
}

const FILE = 'src/rate-limit/limiter.ts';
const AGENT = 'qwen2.5-coder-32b';

function initialFindings(): Finding[] {
	return [
		{
			id: 'f-security-tenant',
			code: 'F-01',
			severity: 'high',
			category: 'security',
			agent: AGENT,
			body: "bucketFor shares one Map across tenants — two tenants behind one egress IP drain each other's budget.",
			file: FILE,
			startLine: 28,
			endLine: 31,
			status: 'open'
		},
		{
			id: 'f-perf-eviction',
			code: 'F-02',
			severity: 'medium',
			category: 'perf',
			agent: AGENT,
			body: 'buckets Map has no eviction, so it grows once per key forever',
			file: FILE,
			startLine: 10,
			endLine: 12,
			status: 'open'
		},
		{
			id: 'f-correctness-clock',
			code: 'F-03',
			severity: 'medium',
			category: 'correctness',
			agent: AGENT,
			body: 'refill() reads Date.now() directly, so the injected Clock is dead weight and tests cannot control time.',
			file: FILE,
			startLine: 20,
			endLine: 23,
			status: 'open'
		},
		{
			id: 'f-docs-allow',
			code: 'F-04',
			severity: 'low',
			category: 'docs',
			agent: AGENT,
			body: '`allow` moved into the class but the doc comment still reads like a free function.',
			file: FILE,
			startLine: 19,
			endLine: 19,
			status: 'open'
		},
		{
			id: 'f-style-capacity',
			code: 'F-05',
			severity: 'low',
			category: 'style',
			agent: AGENT,
			body: 'Constructor takes capacity but never validates it — zero capacity bricks every bucket silently.',
			file: FILE,
			startLine: 13,
			endLine: 16,
			status: 'open'
		},
		{
			id: 'f-note-clock',
			code: 'F-06',
			severity: 'info',
			category: 'note',
			agent: AGENT,
			body: 'Clock is imported here — confirm refill timing moves onto it before removing the Date.now call.',
			file: FILE,
			startLine: 1,
			endLine: 1,
			status: 'open'
		}
	];
}

/** Text filter for the findings searcher (topbar). Empty means no filtering. */
export function matchesQuery(f: Finding, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (q === '') return true;
	return [f.code ?? '', f.body, f.file, f.category, f.agent, f.severity].some((s) =>
		s.toLowerCase().includes(q)
	);
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
		code: `R-${String(index + 1).padStart(2, '0')}`,
		severity: severityMap[f.severity],
		category,
		agent: f.agent ?? 'reviewer',
		model: f.model ?? null,
		body,
		file: f.file,
		startLine: line,
		endLine: f.endLine && f.endLine >= line ? f.endLine : line,
		status: 'open'
	};
}

class FindingsStore {
	items = $state<Finding[]>(initialFindings());
	activeId = $state<string | null>(null);
	/** Finding id currently hovered (card or code) — drives cross-highlighting. */
	hoveredId = $state<string | null>(null);
	/** Topbar search text; cards and navigation filter on it. */
	query = $state('');

	forFile(file: string): Finding[] {
		return this.items.filter((f) => f.file === file);
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

	/** Merge remotely-fetched findings (backend reviews) into the local store. */
	syncRemote(findings: Finding[]): void {
		for (const f of findings) {
			if (!this.items.some((i) => i.id === f.id)) this.items.push(f);
		}
	}

	reset(): void {
		this.items = initialFindings();
		this.activeId = null;
		this.hoveredId = null;
		this.query = '';
	}
}

export const findingsStore = new FindingsStore();
