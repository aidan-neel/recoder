/** `info` is the lowest reported severity (a reviewer's "low"); informational notes are never reported. */
export type FindingSeverity = 'info' | 'warning' | 'error';

export interface FindingLocation {
	file: string;
	line?: number;
	endLine?: number;
	/** Diff side this location refers to. Defaults to `new` when a line exists. */
	side?: 'old' | 'new';
}

/** Defects: the code does the wrong thing. */
export const BUG_CATEGORIES = [
	'correctness',
	'security',
	'concurrency',
	'error-handling',
	'api-contract',
	'data-persistence',
	'performance',
	'intent-mismatch',
	'tests'
] as const;

/** Maintainability: the code works but is harder to read or out of line with the repo. */
export const QUALITY_CATEGORIES = [
	'repo-rule',
	'convention',
	'duplication',
	'dead-code',
	'complexity',
	'readability'
] as const;

export const FINDING_CATEGORIES = [...BUG_CATEGORIES, ...QUALITY_CATEGORIES] as const;

export type BugCategory = (typeof BUG_CATEGORIES)[number];

export type QualityCategory = (typeof QUALITY_CATEGORIES)[number];

export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

/** Bugs and quality findings are listed apart; quality never outranks a bug. */
export type FindingKind = 'bug' | 'quality';

/**
 * The only readability smells a reviewer may report. A closed list keeps the
 * same smell on the same code under the same fingerprint from run to run.
 */
export const READABILITY_SMELLS = [
	'unclear-name',
	'misleading-name',
	'hidden-side-effect',
	'boolean-param-flag',
	'deep-nesting',
	'long-function',
	'mixed-abstraction-levels',
	'magic-value',
	'stale-comment',
	'inconsistent-with-sibling',
	'reinvented-helper'
] as const;

export type ReadabilitySmell = (typeof READABILITY_SMELLS)[number];

const QUALITY_SET: ReadonlySet<string> = new Set(QUALITY_CATEGORIES);

/** Which list a category belongs to; unknown and legacy free-text categories count as bugs. */
export function findingKind(category: string | undefined): FindingKind {
	return category && QUALITY_SET.has(category) ? 'quality' : 'bug';
}

/** A code location a claim's execution path or a convention example points at. */
export interface ClaimStep {
	file: string;
	line: number;
	/** What happens at this step, in a few words. */
	note?: string;
}

/**
 * What a finding asserts, field by field. The verifier establishes each part;
 * the prose body is written from it, never the other way round.
 */
export interface FindingClaim {
	/** The input, state or call that sets the problem off. */
	trigger: string;
	/** How execution gets from the trigger to the changed line. */
	executionPath: ClaimStep[];
	/** What goes wrong that someone can observe. */
	consequence: string;
	/** The precondition, invariant, rule or convention the change breaks. */
	violatedContract: string;
	/** Code that might already prevent it, and why it doesn't. */
	existingGuard?: string;
}

/** A suggested change for a quality finding, applied in the sandbox and checked before it is shown. */
export interface FindingPatch {
	/** Unified diff, repo-rooted with `a/` and `b/` prefixes. */
	diff: string;
	/** Commands that passed with the patch applied (type check, lint). */
	checks: string[];
}

/**
 * How a finding's verification ended, for evals. `reproduced`: a command's
 * output showed the problem. `traced`: it was shown by reading code, a
 * deterministic check or a repo rule. `inconclusive`: nothing proved it.
 * `refuted`: the verifier showed the finding wrong.
 */
export type VerificationOutcome = 'reproduced' | 'traced' | 'inconclusive' | 'refuted';

/**
 * The same command on the merge-base tree. `differs` is false when it ends the
 * same way there, so the run may not isolate the change. `unavailable` says
 * why the base could not be run.
 */
export type VerificationBaseline = { exitCode: number | null; differs: boolean } | { unavailable: string };

/** What a proving run was meant to show and what it showed, so a reader can audit the proof. */
export interface VerificationEvidence {
	command: string;
	exitCode: number | null;
	/** What the verifier said the run would show if the claim holds. */
	expected?: string;
	/** An excerpt of the run's own output, taken by the harness, not written by the model. */
	observed: string;
	/** The recorded run this excerpt came from. */
	evidenceId: string;
	baseline?: VerificationBaseline;
}

/** Whether a finding was proven by running code in the review sandbox. */
export interface FindingVerification {
	status: 'verified' | 'unverified';
	/** What the run showed, or why it could not be proven. */
	reason: string;
	/**
	 * `run`: a command's output proves it. `trace`: the verifier traced it
	 * through the code it read. `detector`: a deterministic check found it.
	 * `rule`: a cited repo rule and the violating span. `convention`: two or
	 * more comparable examples and no common counter-example.
	 */
	method?: 'run' | 'trace' | 'detector' | 'rule' | 'convention';
	/** The command whose output proves the finding. */
	command?: string;
	exitCode?: number | null;
	/** Older saved reviews omit it. */
	outcome?: VerificationOutcome;
	/** The run behind a `run` verification; older saved reviews omit it. */
	evidence?: VerificationEvidence;
}

export interface Finding {
	id: string;
	/** Short issue-specific heading. Older saved reviews may omit it. */
	title?: string;
	file: string;
	line?: number;
	/** Inclusive end of the range this finding refers to (defaults to `line`). */
	endLine?: number;
	severity: FindingSeverity;
	message: string;
	suggestion?: string;
	/** Reviewer role that produced this finding (e.g. `security`). */
	agent?: string;
	/** Model that produced this finding. */
	model?: string;
	/**
	 * Stability fingerprint: hash of file, category, rule or smell, and the
	 * enclosing symbol (or anchor code). The same issue found on a later run
	 * matches, so re-reviews only surface new findings and evals can count
	 * how often each issue is found.
	 */
	fingerprint?: string;
	/** Reviewer or subagent assignment that produced this finding. */
	assignmentId?: string;
	/** A `FindingCategory`; older saved reviews may hold free text. */
	category?: string;
	/** Derived from `category`; older saved reviews omit it and count as bugs. */
	kind?: FindingKind;
	/** The repo rule a `repo-rule` finding breaks, from the rule ledger (`R12`). */
	ruleId?: string;
	/** The smell a `readability` finding names. */
	smell?: ReadabilitySmell;
	/** The enclosing function, method or class, as the change model names it (`ReviewRun.createRun`). */
	symbol?: string;
	claim?: FindingClaim;
	/** A checked fix, on quality findings. */
	patch?: FindingPatch;
	/** Which lens or detector raised it (`correctness`, `detector:duplication`). */
	lens?: string;
	evidenceIds?: string[];
	relatedLocations?: FindingLocation[];
	/** Diff side for deleted-code findings. Defaults to `new` when a line exists. */
	side?: 'old' | 'new';
	verification?: FindingVerification;
	/**
	 * Ids of the candidates merged into this finding, earliest raised first,
	 * so an evaluation can trace each published claim to the reports behind it.
	 * Older saved reviews omit it.
	 */
	memberIds?: string[];
}
