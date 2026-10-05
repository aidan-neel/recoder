import type { FindingPatch, QualityCategory } from '@recoder/shared';

/** Which deterministic check produced a result. */
export type DetectorId =
	| 'lint'
	| 'typecheck'
	| 'type-hint'
	| 'duplication'
	| 'dead-code'
	| 'complexity'
	| 'rule-check'
	| 'weakened-tests'
	| 'weak-new-tests'
	| 'mutation';

/**
 * A tool's diagnostic as a record. The head has it by construction, since the
 * tool ran on the head; the base lacks it when the line is one the change adds.
 */
interface Diagnostic {
	tool: string;
	rule?: string;
	severity: 'error' | 'warning';
	base: 'absent';
	head: 'present';
}

/**
 * A finding a detector produced without a model. It is verified by
 * construction (method `detector`) and goes straight to consolidation,
 * unless it is only `suspected`.
 */
export interface DetectorResult {
	detector: DetectorId;
	category: QualityCategory | 'correctness' | 'tests';
	title: string;
	/** Short markdown in the finding body style. */
	body: string;
	file: string;
	line: number;
	endLine?: number;
	/** Enclosing symbol's qualified name, from the change model. */
	symbol?: string;
	ruleId?: string;
	/** The tool's own diagnostic, for results that come from a type check or linter. */
	diagnostic?: Diagnostic;
	/** What the detector saw: the diagnostic line, the duplicate's location, the metric against the repo's p95. */
	evidence: string;
	relatedLocations?: { file: string; line: number; endLine?: number }[];
	patch?: FindingPatch;
	/** A heuristic rather than a proof, so a verifier settles it like a reviewer's finding. */
	suspected?: boolean;
}
