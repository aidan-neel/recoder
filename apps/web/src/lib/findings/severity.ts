import type { FindingSeverity } from './findings.svelte';

/** Rank of each severity, most severe first. */
const SEVERITY_RANK: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2 };

/** Sort comparator that puts the more severe of two findings first. */
export function compareSeverity(a: { severity: FindingSeverity }, b: { severity: FindingSeverity }): number {
	return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
}
