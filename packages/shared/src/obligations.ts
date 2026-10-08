import type { VerificationBaseline } from './findings';

/** The eight kinds of risky change that oblige an investigation (issue #66). */
export type ObligationTrigger =
	| 'truthy-default'
	| 'boundary'
	| 'removed-guard'
	| 'normalization'
	| 'resource-release'
	| 'count-validation'
	| 'error-contract'
	| 'weaker-assertion';

/**
 * A specific question about changed behavior, derived mechanically from the
 * change model. It is never a finding: an investigation answers it.
 */
export interface Obligation {
	/** `obligation-1`, `obligation-2`… in file, line and trigger order. */
	id: string;
	/** The review unit (`unit-1`…) whose slice holds the changed line. */
	unitId: string;
	hunkId: string;
	/** The lens whose specialist question this is (`correctness`, `security`…). */
	specialist: string;
	trigger: ObligationTrigger;
	question: string;
	/** `side: 'old'` for code the change removed, read at the merge base. */
	location: { file: string; line: number; side: 'new' | 'old' };
	/** The changed code that set the trigger off, clipped. */
	code: string;
	/** The enclosing symbol's qualified name, or null outside every symbol. */
	symbol: string | null;
	/** Where the contract may be written down: signatures, tests, callers and what set the trigger off. */
	contractHints: string[];
}

export type ObligationResult = 'confirmed' | 'disproved' | 'not-applicable' | 'unresolved';

/** One investigation's fixed answer; unresolved and unlaunched ones are kept too. */
export interface ObligationAnswer {
	obligationId: string;
	contractEvidence: { kind: 'type' | 'test' | 'doc' | 'intent' | 'source'; location: string; note: string }[];
	/** Below, at and above the boundary, or the equivalent classes of input. */
	inputPartition: { label: string; input: string; expected: string }[];
	expectedBehavior: string;
	/** The input tried against the changed code and what it did; `base` is the same run on the merge base. */
	attemptedCounterexample: {
		input: string;
		command: string | null;
		evidenceId: string | null;
		observed: string;
		base?: VerificationBaseline;
	} | null;
	result: ObligationResult;
	/** Why the investigator gave this result, or why none was reached. */
	reason: string;
	evidenceIds: string[];
	elapsedMs: number;
	/** Of `elapsedMs`, the time its sandbox calls waited behind other agents' calls in the workspace queue. */
	queuedMs: number;
	/** `elapsedMs` less `queuedMs`: the time the box measures. */
	workingMs: number;
	/** Model calls it made. */
	turns: number;
	/** Output tokens the investigation's model calls reported; null when no call reported usage. */
	tokens: number | null;
	/** The time box the investigation ran under. */
	timeBoxMs: number;
	/** False when the cap, the budget or the deadline kept it from starting. */
	launched: boolean;
	/** The candidate a confirmed answer published. */
	candidateId?: string;
}

/** Per-review obligation counts for the summary and the eval report. */
export interface ObligationCounts {
	derived: number;
	launched: number;
	/** Derived but left out by the cap. */
	overCap: number;
	/** Under the cap, but the budget or the deadline kept it from starting; counted as unresolved too. */
	notLaunched: number;
	confirmed: number;
	disproved: number;
	notApplicable: number;
	unresolved: number;
	/** Confirmed answers whose candidate the verifier then proved. */
	verified: number;
}

/** What the launched investigations of a review spent in all. */
export interface ObligationSpend {
	elapsedMs: number;
	queuedMs: number;
	workingMs: number;
	turns: number;
	/** Null when no investigation's model calls reported usage. */
	tokens: number | null;
}

/** What a review reports about its obligations; absent when `RECODER_OBLIGATIONS` is off. */
export interface ObligationReport {
	counts: ObligationCounts;
	spent: ObligationSpend;
	cap: number;
	timeBoxMs: number;
	obligations: Obligation[];
	answers: ObligationAnswer[];
}
