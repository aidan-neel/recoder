import { categoryLabel, type EvidenceClass } from '@recoder/shared';
import { Pill } from '@recoder/ui';
import { BookText, CircleCheck, CircleDashed, Route, type LucideIcon } from 'lucide-react';

import type { BugView } from '@/lib/bugs/types';

/** What a finding that came from an earlier review of this pull request says about that. */
const HISTORY_LABELS = { carried: 'From the last review', rechecked: 'Checked again' } as const;

/** The category every repository-rule finding has; its evidence badge already says it. */
const RULE_CATEGORY = categoryLabel('repo-rule');

/** Each class of evidence as an icon. Only a reproduced bug, proven by a run, is coloured. */
const EVIDENCE_ICONS: Record<EvidenceClass, LucideIcon> = {
	reproduced: CircleCheck,
	traced: Route,
	rule: BookText,
	unverified: CircleDashed
};

/** How the bug was shown: reproduced by a run (green), traced in code, a repository rule, or not checked. */
export function EvidencePill({ bug }: { bug: Pick<BugView, 'evidence' | 'evidenceLabel'> }) {
	const Icon = EVIDENCE_ICONS[bug.evidence];

	return (
		<Pill tone={bug.evidence === 'reproduced' ? 'ok' : 'neutral'} icon={<Icon aria-hidden />}>
			{bug.evidenceLabel}
		</Pill>
	);
}

/** How serious the bug is, in its severity's colour; a suggestion says so instead. */
function SeverityPill({ bug }: { bug: BugView }) {
	const dot = <span aria-hidden className="pill-dot" />;

	if (bug.kind === 'suggestion') {
		return (
			<Pill tone="low" icon={dot}>
				Suggestion
			</Pill>
		);
	}

	return (
		<Pill tone={bug.tone} icon={dot}>
			{bug.severity}
		</Pill>
	);
}

/**
 * The facts of a bug as one row of badges, in the order a reader scans them:
 * how serious, what kind, how it was shown, where it is, and whether an
 * earlier review reported it. A rule finding's category is left out, since
 * its evidence badge already names the rule.
 */
export function BugFacts({ bug }: { bug: BugView }) {
	const history = bug.history === 'carried' || bug.history === 'rechecked' ? HISTORY_LABELS[bug.history] : null;
	const repeatsEvidence = bug.evidence === 'rule' && bug.category === RULE_CATEGORY;

	return (
		<span className="bug-facts">
			<SeverityPill bug={bug} />
			{repeatsEvidence ? null : <Pill>{bug.category}</Pill>}
			<EvidencePill bug={bug} />
			<Pill face="code" title={bug.file}>
				{bug.where}
			</Pill>
			{history ? <Pill>{history}</Pill> : null}
		</span>
	);
}
