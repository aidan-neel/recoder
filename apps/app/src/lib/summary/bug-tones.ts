import { openFound } from '../bugs/bug-lists';
import type { BugTone, BugView } from '../bugs/types';
import { plural } from '../shell/format';

/** One badge of the overview: how many open findings share a tier. */
export interface SeverityCount {
	tone: BugTone;
	label: string;
}

/** Open bugs, then warnings, then suggestions, each as its own badge; one with none is left out. FYI is never counted. */
export function severityCounts(open: readonly BugView[]): SeverityCount[] {
	const found = openFound(open);

	const counts: [number, BugTone, string][] = [
		[found.bugs, 'high', 'bug'],
		[found.warnings, 'medium', 'warning'],
		[found.suggestions, 'low', 'suggestion']
	];

	return counts.filter(([count]) => count > 0).map(([count, tone, word]) => ({ tone, label: plural(count, word) }));
}
