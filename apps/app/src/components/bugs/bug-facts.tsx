import { categoryLabel, type EvidenceClass } from '@recoder/shared';
import { Icon, Pill, type IconName } from '@recoder/ui';

import type { BugView } from '@/lib/bugs/types';

/** What a finding that came from an earlier review of this pull request says about that. */
const HISTORY_LABELS = { carried: 'From the last review', rechecked: 'Checked again' } as const;

/** The category every repository-rule finding has; its evidence badge already says it. */
const RULE_CATEGORY = categoryLabel('repo-rule');

/** Each class of evidence as an icon. Only a reproduced bug, proven by a run, is coloured. */
const EVIDENCE_ICONS: Record<EvidenceClass, IconName> = {
	reproduced: 'check_circle',
	traced: 'route',
	rule: 'book',
	unverified: 'pending'
};

/** How the bug was shown: reproduced by a run (green), traced in code, a repository rule, or not checked. */
export function EvidencePill({ bug }: { bug: Pick<BugView, 'evidence' | 'evidenceLabel'> }) {
	const icon = EVIDENCE_ICONS[bug.evidence];

	return (
		<Pill tone={bug.evidence === 'reproduced' ? 'ok' : 'neutral'} icon={<Icon name={icon} />}>
			{bug.evidenceLabel}
		</Pill>
	);
}

/** That an earlier review of this pull request reported the bug too; nothing for a new one. */
export function HistoryPill({ bug }: { bug: Pick<BugView, 'history'> }) {
	return bug.history === 'carried' || bug.history === 'rechecked' ? <Pill>{HISTORY_LABELS[bug.history]}</Pill> : null;
}

/** The bug's category, or null for a repository-rule finding, whose evidence already names the rule. */
export function shownCategory(bug: Pick<BugView, 'evidence' | 'category'>): string | null {
	return bug.evidence === 'rule' && bug.category === RULE_CATEGORY ? null : bug.category;
}
