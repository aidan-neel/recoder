'use client';

import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Markdown, StatusGlyph } from '@recoder/ui';
import { ArrowUpRightIcon, CaretDownIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import type { BugView } from '@/lib/bugs/types';
import type { ChangesTarget } from '@/lib/changes/types';

import { EvidencePill } from '@/components/bugs/bug-facts';
import { TabLink } from '@/components/common/tab-link';

interface LineBugProps {
	bug: BugView;
	/** The Review tab, where the card opens this bug. */
	href: string;
	/** An ask to bring this finding into view; it opens the finding. */
	target: ChangesTarget | null;
}

/**
 * A finding where it happens in the diff: one line with its severity, title and evidence, so the code around it
 * stays readable. Pressed, it opens in place to say what is wrong, with a link that opens the whole finding on
 * the Review tab. A jump to the finding opens it too.
 */
export function LineBug({ bug, href, target }: LineBugProps) {
	const [open, setOpen] = useState(target !== null);
	const [seen, setSeen] = useState(target);

	if (target !== seen) {
		setSeen(target);

		if (target) setOpen(true);
	}

	return (
		<Collapsible open={open} onOpenChange={setOpen} className="line-bug" data-tone={bug.tone}>
			<CollapsibleTrigger className="line-bug-head" data-finding={bug.id}>
				<StatusGlyph kind={bug.tone} label={bug.severity} />
				<span className="line-bug-title">{bug.title}</span>
				<EvidencePill bug={bug} />
				<CaretDownIcon aria-hidden className="line-bug-caret" />
			</CollapsibleTrigger>
			<CollapsibleContent className="line-bug-body">
				<Markdown className="line-bug-text">{bug.explanation}</Markdown>
				<div className="line-bug-foot">
					<Button asChild variant="outline" size="sm">
						<TabLink href={`${href}#bug-${bug.id}`}>
							Open in Review
							<ArrowUpRightIcon aria-hidden />
						</TabLink>
					</Button>
					<span className="meta">
						{bug.kind === 'suggestion' ? 'Suggestion' : bug.severity} · {bug.category}
					</span>
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
