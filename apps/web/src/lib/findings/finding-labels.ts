import type { FindingCategory, FindingVerification, ReadabilitySmell } from '@recoder/shared';

/** Short names for each finding category, as the findings list and cards show them. */
const CATEGORY_LABELS: Record<FindingCategory, string> = {
	correctness: 'Correctness',
	security: 'Security',
	concurrency: 'Concurrency',
	'error-handling': 'Error handling',
	'api-contract': 'API contract',
	'data-persistence': 'Data persistence',
	performance: 'Performance',
	'intent-mismatch': 'Intent mismatch',
	tests: 'Tests',
	'repo-rule': 'Repo rule',
	convention: 'Convention',
	duplication: 'Duplication',
	'dead-code': 'Dead code',
	complexity: 'Complexity',
	readability: 'Readability'
};

/** Readability smells in plain words. */
export const SMELL_LABELS: Record<ReadabilitySmell, string> = {
	'unclear-name': 'Unclear name',
	'misleading-name': 'Misleading name',
	'hidden-side-effect': 'Hidden side effect',
	'boolean-param-flag': 'Boolean flag parameter',
	'deep-nesting': 'Deep nesting',
	'long-function': 'Long function',
	'mixed-abstraction-levels': 'Mixed abstraction levels',
	'magic-value': 'Magic value',
	'stale-comment': 'Stale comment',
	'inconsistent-with-sibling': 'Unlike its siblings',
	'reinvented-helper': 'Reinvents a helper'
};

type VerifyMethod = NonNullable<FindingVerification['method']>;

/** The verification badge's word for how a finding was proven. */
export const VERIFY_METHOD_LABELS: Record<VerifyMethod, string> = {
	run: 'Verified',
	trace: 'Traced',
	detector: 'Detector',
	rule: 'Repo rule',
	convention: 'Convention'
};

/** How the detail view opens its proof sentence for each method. */
export const VERIFY_METHOD_NOTES: Record<VerifyMethod, string> = {
	run: 'Verified',
	trace: 'Traced through the code',
	detector: 'Found by a detector',
	rule: 'Breaks a repo rule',
	convention: 'Breaks a convention'
};

/** A category's label; older reviews hold free text (`perf`), shown with a capital and spaces. */
export function categoryLabel(category: string): string {
	if (category in CATEGORY_LABELS) return CATEGORY_LABELS[category as FindingCategory];

	const words = category.replace(/[-_]+/g, ' ').trim();

	return words ? words[0].toUpperCase() + words.slice(1) : 'Review';
}
