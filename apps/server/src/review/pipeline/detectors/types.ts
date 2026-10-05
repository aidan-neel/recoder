import type { FindingPatch, QualityCategory } from '@recoder/shared';

/** Which deterministic check produced a result. */
export type DetectorId =
	| 'lint'
	| 'typecheck'
	| 'duplication'
	| 'dead-code'
	| 'complexity'
	| 'rule-check'
	| 'weakened-tests'
	| 'weak-new-tests';

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
	/** What the detector saw: the diagnostic line, the duplicate's location, the metric against the repo's p95. */
	evidence: string;
	relatedLocations?: { file: string; line: number; endLine?: number }[];
	patch?: FindingPatch;
	/** A heuristic rather than a proof, so a verifier settles it like a reviewer's finding. */
	suspected?: boolean;
}
