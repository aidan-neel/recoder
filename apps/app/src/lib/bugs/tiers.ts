import { findingTier, type Finding, type FindingTier } from '@recoder/shared';

import { plural } from '../shell/format';
import type { BugTone } from './types';

/** Each tier as every screen names it. */
export const TIER_LABELS: Record<FindingTier, string> = { bug: 'Bug', warning: 'Warning', fyi: 'FYI' };

/** The colour each tier wears: a bug the high-severity red, a warning amber, FYI the quiet blue. */
export const TIER_TONES: Record<FindingTier, BugTone> = { bug: 'high', warning: 'medium', fyi: 'low' };

/** Open findings that ask for something, by what they are; FYI is commentary and never counted here. */
export interface FoundCounts {
	bugs: number;
	warnings: number;
	suggestions: number;
}

/** A finding as the counts read it: its tier, and whether it is a suggestion rather than a defect. */
interface Counted {
	tier: FindingTier;
	suggestion: boolean;
}

/** Bugs, warnings and suggestions among `findings`, leaving FYI out. */
export function countFound(findings: readonly Counted[]): FoundCounts {
	const counted = findings.filter((finding) => finding.tier !== 'fyi');
	const suggestions = counted.filter((finding) => finding.suggestion).length;
	const bugs = counted.filter((finding) => !finding.suggestion && finding.tier === 'bug').length;

	return { bugs, warnings: counted.length - suggestions - bugs, suggestions };
}

/** A stored or listed finding as the counts read it: a quality finding is a suggestion. */
export function counted(finding: Pick<Finding, 'tier' | 'severity' | 'kind'>): Counted {
	return { tier: findingTier(finding), suggestion: finding.kind === 'quality' };
}

/** How many there are in all. */
export function foundTotal(found: FoundCounts): number {
	return found.bugs + found.warnings + found.suggestions;
}

/** What a review left open, in the words every screen uses: `2 bugs`, `1 warning`, `2 bugs, 1 suggestion`. */
export function foundLabel(found: FoundCounts): string {
	const parts = [
		[found.bugs, 'bug'],
		[found.warnings, 'warning'],
		[found.suggestions, 'suggestion']
	] as const;

	return parts
		.filter(([count]) => count > 0)
		.map(([count, word]) => plural(count, word))
		.join(', ');
}

/** The colour of a count: a bug's when it holds one, a warning's when it holds one, else the quiet one. */
export function foundTone(found: FoundCounts): BugTone {
	if (found.bugs > 0) return 'high';
	if (found.warnings > 0) return 'medium';

	return 'low';
}
