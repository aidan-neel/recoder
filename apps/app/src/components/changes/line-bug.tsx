import { Pill, StatusGlyph } from '@recoder/ui';
import Link from 'next/link';

import type { BugView } from '@/lib/bugs/types';

/** The pill tone for each class of evidence: proven by a run reads as settled, the rest as plain facts. */
export const EVIDENCE_TONES = {
	reproduced: 'ok',
	traced: 'low',
	rule: 'sent',
	unverified: 'neutral'
} as const;

interface LineBugProps {
	bug: BugView;
	/** The Bugs tab, where the card opens this bug. */
	href: string;
}

/** A bug where it happens in the diff: its title and how it was shown. It opens the bug on the Bugs tab. */
export function LineBug({ bug, href }: LineBugProps) {
	return (
		<Link href={`${href}#bug-${bug.id}`} replace scroll={false} className="line-bug">
			<StatusGlyph kind={bug.tone} label={bug.severity} />
			<span className="line-bug-title">{bug.title}</span>
			<Pill tone={EVIDENCE_TONES[bug.evidence]}>{bug.evidenceLabel}</Pill>
		</Link>
	);
}
