import type {
	DismissalReason,
	EvidenceClass,
	FindingDecision,
	FindingRule,
	FindingTier,
	ReviewSpeed
} from '@recoder/shared';

/** The colour a finding wears, from its tier. */
export type BugTone = 'high' | 'medium' | 'low';

/** The run that proves a reproduced finding. */
export interface BugProof {
	command: string;
	exitCode: number | null;
	/** What the verifier said the run would show if the claim holds. */
	expected: string | null;
	/** The run's own output, cut to the part that matters. */
	output: string;
	/** How the same command ended on the base branch, as one sentence; null when it was not compared. */
	base: string | null;
}

/** A finding of the newest review as the Review tab shows it. `suggestion`: a quality finding with a checked fix. */
export interface BugView {
	id: string;
	kind: 'bug' | 'suggestion';
	title: string;
	/** `bug`: a probable defect. `warning`: risky, uncertain or lower impact. `fyi`: commentary, never a defect. */
	tier: FindingTier;
	tone: BugTone;
	/** `Bug`, `Warning` or `FYI`. */
	tierLabel: string;
	/** `Concurrency`, `Error handling`. */
	category: string;
	file: string;
	line: number | null;
	endLine: number | null;
	evidence: EvidenceClass;
	/** The shared label for `evidence`. */
	evidenceLabel: string;
	/** What is wrong and what happens, as markdown. */
	explanation: string;
	/** Set when `evidence` is `reproduced`. */
	proof: BugProof | null;
	/** Set when `evidence` is `traced`: how execution reaches the problem, one step per row. */
	trace: { file: string; line: number | null; note: string }[];
	/** Set when `evidence` is `rule`. */
	rule: FindingRule | null;
	/** The suggested fix: a unified diff when the review checked one, else the reviewer's words; null when it gave none. */
	fix: { diff: string; checks: string[] } | { text: string } | null;
	/** `carried` and `rechecked` findings were reported by an earlier review of this pull request. */
	history: 'new' | 'carried' | 'rechecked' | null;
	/** What a person decided; null while the finding is open. */
	decision: FindingDecision | null;
	/** The comment on the pull request, once the finding was posted. */
	posted: { url: string } | null;
	/** The person's vote on whether the finding helped. */
	vote: 'useful' | 'not-useful' | null;
	/** Why moved code fails where it now sits, when the finding is on lines the change moved; null otherwise. */
	moveReason: string | null;
}

/** Work the review could not finish. It is shown apart and never counts as a finding. */
export interface UnresolvedItem {
	id: string;
	/** `question`: nobody could settle it. `prerequisite`: a check the review needed did not run. `skipped`: an investigation was left out. */
	kind: 'question' | 'prerequisite' | 'skipped';
	title: string;
	/** Why it stayed open, in one or two sentences. */
	detail: string;
}

/** The Review tab: the findings of the newest review, and what a person can do with each. */
export interface BugsView {
	/** `none`: no finished review yet (the run card shows instead). */
	phase: 'none' | 'loading' | 'ready' | 'failed';
	error: string | null;
	/** Open findings that ask for something: bugs before suggestions, then by tier, then by file. FYI is not here. */
	open: BugView[];
	/** Open FYI notes: commentary on the change, never counted as a bug. */
	fyi: BugView[];
	/** Findings a person accepted or dismissed, newest decision first. */
	decided: BugView[];
	/** Findings of the review before this one that this review shows fixed, with what showed it. */
	resolved: { bug: BugView; reason: string }[];
	/** Findings of a topic people keep dismissing; shown collapsed and left out of every count. */
	quieted: BugView[];
	unresolved: UnresolvedItem[];
	/**
	 * What the review checked and found sound: claims it investigated and those
	 * it cleared, the changed units its brief read in full out of all of them,
	 * and the candidates it raised and dropped. `units` and `ruledOut` are null
	 * on reviews that did not record them.
	 */
	checked: {
		claims: number;
		cleared: number;
		units: { read: number; total: number } | null;
		ruledOut: number | null;
	};
	/** The forge review the finished findings went up as, once someone posted them; null before. */
	findingsReview: { state: 'posting' | 'posted' | 'failed'; url: string | null; error: string | null } | null;
	/** While a new review runs: the open findings of the review before it, to read but not to act on; null otherwise. */
	previous: { open: BugView[]; headSha: string | null; reviewedAt: string | null } | null;
	/** Facts for the line under the tabs. */
	reviewedAt: string | null;
	headSha: string | null;
	/** `6m 40s`. */
	duration: string | null;
	modelLabel: string | null;
	/** How fast the review ran: `spark` says why it may have found less. */
	speed: ReviewSpeed;
	/** True when the forge takes comments and a token with write access is connected. */
	canPost: boolean;
	/** Ids of the findings with a write in flight. */
	pending: ReadonlySet<string>;
	/** Posts one finding as a comment on its diff line, or updates the comment it has. */
	post: (id: string) => Promise<void>;
	/** Posts every open finding in one review on the pull request. */
	postAll: () => Promise<void>;
	postingAll: boolean;
	accept: (id: string) => Promise<void>;
	dismiss: (id: string, reason: DismissalReason, note?: string) => Promise<void>;
	/** Opens a decided finding again. */
	reopen: (id: string) => Promise<void>;
	/** Turns a quieted topic back on, so its findings count again. */
	unquiet: (id: string) => Promise<void>;
	/** Saves the vote; null takes it back. */
	vote: (id: string, vote: 'useful' | 'not-useful' | null) => Promise<void>;
	/** The text to hand a coding agent so it fixes the finding: what is wrong, where, the evidence and the suggested fix. */
	fixPrompt: (id: string) => string;
}

/** What the Summary tab shows above the conversation. */
export interface SummaryView {
	/** The review's account of the change, as markdown; null before a review wrote one. */
	analysis: string | null;
	/** The pull request's description, as untrusted markdown; null when it has none. */
	description: string | null;
}
