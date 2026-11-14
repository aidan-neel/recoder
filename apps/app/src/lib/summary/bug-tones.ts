import type { BugTone, BugView } from '../bugs/types';
import { plural } from '../shell/format';

/** One badge of the overview: how many open findings share a severity. */
export interface SeverityCount {
	tone: BugTone;
	label: string;
}

/** Severities from the worst down. */
const TONES: readonly BugTone[] = ['high', 'medium', 'low'];

/** Open bugs per severity, worst first, then the suggestions; a severity with none is left out. */
export function severityCounts(open: readonly BugView[]): SeverityCount[] {
	const bugs = open.filter((bug) => bug.kind === 'bug');

	const severities = TONES.map((tone) => ({ tone, count: bugs.filter((bug) => bug.tone === tone).length }))
		.filter((entry) => entry.count > 0)
		.map(({ tone, count }) => ({ tone, label: `${count} ${tone}` }));

	const suggestions = open.length - bugs.length;

	return suggestions > 0 ? [...severities, { tone: 'low', label: plural(suggestions, 'suggestion') }] : severities;
}

/** The worst severity among the open bugs in `paths`; null when they hold none. */
export function worstTone(paths: readonly string[], open: readonly BugView[]): BugTone | null {
	const files = new Set(paths);
	const tones = new Set(open.filter((bug) => bug.kind === 'bug' && files.has(bug.file)).map((bug) => bug.tone));

	return TONES.find((tone) => tones.has(tone)) ?? null;
}
