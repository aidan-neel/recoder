import {
	EVIDENCE_GROUPS,
	FINDING_CLASSES,
	precisionBounds,
	type ClassCounts,
	type LabelGroup,
	type LabelSummary
} from './benchmark-labels';

export const percent = (value: number) => `${(value * 100).toFixed(0)}%`.padStart(4);

/** "precision 39% to 87% of 194 (U 94)": both bounds over every published finding, and how many are still unresolved. */
function boundsText(counts: ClassCounts): string {
	const bounds = precisionBounds(counts);

	if (!bounds) return 'precision n/a';

	return `precision ${percent(bounds.lower)} to ${percent(bounds.upper)} of ${bounds.published} (U ${bounds.unresolved})`;
}

function groupLine(label: string, { counts, runs }: LabelGroup, withRates: boolean): string {
	const classes = FINDING_CLASSES.map((kind) => `${counts[kind]} ${kind}`).join(' · ');

	const rates =
		withRates && runs
			? ` · per PR: ${(counts.false / runs).toFixed(2)} false, ${(counts.unresolved / runs).toFixed(2)} unresolved, ${(counts.duplicate / runs).toFixed(2)} duplicate`
			: '';

	return `  ${label.padEnd(18)} ${classes} · ${boundsText(counts)}${rates}`;
}

/**
 * Every finding in one of five classes, the precision interval they allow,
 * noise per PR, the control PRs' wrong-comment rate and the same bounds by
 * evidence group. An unresolved finding is not counted wrong until a human
 * labels it, so read false comments next to unresolved.
 */
export function labelLines({ overall, byCodebase, byEvidence, control, hiddenAdditional }: LabelSummary): string[] {
	if (!overall.runs) return [];

	const controlLine = control.runs
		? `  ${control.prs} control PRs, ${control.runs} runs: wrong published comment in ${percent(control.wrong / control.runs)} of runs, ${percent(control.possiblyWrong / control.runs)} counting unresolved`
		: '  no control PRs in this run';

	return [
		'',
		'Findings by class (precision over every published finding is an interval until every unresolved one is labeled)',
		groupLine('all', overall, true),
		...Object.keys(byCodebase)
			.sort()
			.map((key) => groupLine(key, byCodebase[key]!, true)),
		'',
		'By evidence',
		...EVIDENCE_GROUPS.map((key) => groupLine(key, byEvidence[key], false)),
		'',
		'Control PRs',
		controlLine,
		...(hiddenAdditional
			? [
					'',
					`Hidden by verification: ${hiddenAdditional} more additional true positives only hidden candidates reported`
				]
			: [])
	];
}
