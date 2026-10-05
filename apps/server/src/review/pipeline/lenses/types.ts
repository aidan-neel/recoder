import type { FindingCategory } from '@recoder/shared';

export type LensId =
	'correctness' | 'security' | 'concurrency' | 'api-contract' | 'performance' | 'rules' | 'conventions' | 'readability';

/**
 * A fixed review procedure. Every unit runs every lens that applies to it, and
 * each lens reports only its own categories, so what gets checked doesn't
 * depend on what a model happens to notice.
 */
export interface Lens {
	id: LensId;
	title: string;
	/** Categories this lens may report; anything else it returns is dropped. */
	categories: readonly FindingCategory[];
	/** The numbered procedure the lens follows, step by step. */
	procedure: string;
}
