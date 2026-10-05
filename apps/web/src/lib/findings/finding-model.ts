import {
	findingKind,
	type Finding as BackendFinding,
	type FindingKind,
	type FindingPatch,
	type FindingSeverity as BackendSeverity,
	type FindingVerification,
	type ReadabilitySmell
} from '@recoder/shared';
import { findingTitle } from './finding-title';

export type FindingSeverity = 'high' | 'medium' | 'low';

/** A review finding as the cards, diff and threads show it. */
export interface Finding {
	id: string;
	/** Legacy reference retained for existing links and searches. */
	code: string | null;
	title: string;
	severity: FindingSeverity;
	/** A `FindingCategory` (`security`, `dead-code`); older reviews hold free text. */
	category: string;
	/** Bugs and code quality are listed apart. */
	kind: FindingKind;
	/** The repo rule a `repo-rule` finding breaks (`R3`). */
	ruleId?: string;
	/** The smell a `readability` finding names. */
	smell?: ReadabilitySmell;
	/** The enclosing function, method or class (`RateLimiter.bucketFor`). */
	symbol?: string;
	/** A fix the review applied in its sandbox and checked. */
	patch?: FindingPatch;
	/** Reviewer role that owns this finding, e.g. `security`. */
	agent: string;
	/** Model that produced this finding, when known. */
	model?: string | null;
	body: string;
	file: string;
	/** New-side line range the finding refers to (inclusive). */
	startLine: number;
	endLine: number;
	/** Tool results the reviewer cited (`ev_…`), matched against the review's tool calls. */
	evidenceIds?: string[];
	assignmentId?: string;
	/** Whether a run in the review sandbox proved it. Older reviews omit it. */
	verification?: FindingVerification;
	status: 'open' | 'dismissed';
}

const SEVERITY_MAP: Record<BackendSeverity, FindingSeverity> = {
	error: 'high',
	warning: 'medium',
	info: 'low'
};

/**
 * Map a backend finding (harness output) onto the local card/thread model. Older reviews carry the
 * category as a `[category]` prefix on the message and no kind, so both fall back from there.
 */
export function mapBackendFinding(f: BackendFinding, index: number): Finding {
	const match = /^\[([^\]]+)\]\s*/.exec(f.message);
	const category = f.category ?? match?.[1] ?? 'review';
	const body = match ? f.message.slice(match[0].length) : f.message;
	const line = f.line ?? 1;

	return {
		id: f.id,
		code: `F-${String(index + 1).padStart(2, '0')}`,
		title: findingTitle(body, f.title),
		severity: SEVERITY_MAP[f.severity],
		category,
		kind: f.kind ?? findingKind(category),
		ruleId: f.ruleId,
		smell: f.smell,
		symbol: f.symbol,
		patch: f.patch,
		agent: f.agent ?? 'reviewer',
		model: f.model ?? null,
		body,
		file: f.file,
		startLine: line,
		endLine: f.endLine && f.endLine >= line ? f.endLine : line,
		evidenceIds: f.evidenceIds ?? [],
		assignmentId: f.assignmentId,
		verification: f.verification,
		status: 'open'
	};
}
