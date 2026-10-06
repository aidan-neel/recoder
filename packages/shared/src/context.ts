/** What a piece of reviewer context is: the changed code, its patch, who uses it, what tests or resembles it, or its contract. */
export type ContextKind =
	'source' | 'diff' | 'caller' | 'reference' | 'test' | 'sibling' | 'contract' | 'search' | 'list';

/** One place a reviewer was given, read or cited: a path and a line range, never the content. */
export interface ContextItem {
	kind: ContextKind;
	path: string;
	startLine?: number;
	endLine?: number;
	/** The changed declaration it is about, as the change model names it (`Limiter.take`). */
	symbol?: string;
	/** Why it was chosen: a caller's selection reason, or the rule that made a contract relevant. */
	why?: string;
}

/**
 * Which bound kept context out: callers not shown because the contract did
 * not change, the per-symbol caller, reference or test cap, the prompt block's
 * size, a file read's size, or a patch page.
 */
export type OmissionReason =
	| 'contract-unchanged'
	| 'caller-cap'
	| 'reference-cap'
	| 'test-cap'
	| 'context-cap'
	| 'file-cap'
	| 'diff-cap';

/** Context a bound left out, with the bound that did it. */
export interface ContextOmission extends ContextItem {
	reason: OmissionReason;
}

/**
 * How a reviewer had the evidence it cited: put in its prompt, fetched by its
 * own tool call, or neither as far as the record shows (a checkpoint from
 * before reads were recorded, or evidence another agent retrieved).
 */
export type CitedVia = 'supplied' | 'read' | 'unknown';

/**
 * What one prompt supplied and what bounds left out of it, stored once for
 * every reviewer given the same prompt (the lens assignments of one slice).
 */
export interface UnitContext {
	/** The scoped patch and the change model's declarations, callers, tests, siblings and contracts. */
	supplied: ContextItem[];
	/** The first 50 per reason; the rest are counted in `omittedPast`. */
	omitted: ContextOmission[];
	omittedPast?: Partial<Record<OmissionReason, number>>;
}

/** One reviewer unit (a lens assignment or a subagent) and the context it worked with. */
export interface ReviewerContext {
	assignmentId: string;
	role: string;
	lens?: string;
	/** Its prompt's entry in `ReviewContext.units`; unset when its prompt was not captured (a checkpoint from before prompts were kept). */
	unit?: string;
	/** Fetched by the reviewer's own tool calls. */
	read: ContextItem[];
	/** Evidence its candidates cited. */
	cited: (ContextItem & { via: CitedVia })[];
	/** What bounds cut from its own reads. */
	omitted: ContextOmission[];
	/** Reads past the per-reviewer cap: counted, not listed. */
	readsDropped?: number;
}

/**
 * How a published finding's reporters had the evidence they cited: one count
 * per member and evidence id, by way, all zero when it cites nothing a reviewer
 * held. `readBy` counts the members that cited something they fetched themselves.
 */
export interface FindingCitation {
	findingId: string;
	cited: Record<CitedVia, number>;
	members: number;
	readBy: number;
}

/** What every reviewer of a review received, read, cited and missed, so an eval can tell missing context from unused context. */
export interface ReviewContext {
	units: Record<string, UnitContext>;
	reviewers: ReviewerContext[];
	findings: FindingCitation[];
}
