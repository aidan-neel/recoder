import { StatusGlyph } from '@recoder/ui';
import { TabLink } from '@/components/common/tab-link';

import type { BugView } from '@/lib/bugs/types';

import { EvidencePill } from '@/components/bugs/bug-facts';

interface LineBugProps {
	bug: BugView;
	/** The Review tab, where the card opens this bug. */
	href: string;
}

/** A bug where it happens in the diff: its title and how it was shown. It opens the bug on the Review tab. */
export function LineBug({ bug, href }: LineBugProps) {
	return (
		<TabLink href={`${href}#bug-${bug.id}`} className="line-bug">
			<StatusGlyph kind={bug.tone} label={bug.severity} />
			<span className="line-bug-title">{bug.title}</span>
			<EvidencePill bug={bug} />
		</TabLink>
	);
}
