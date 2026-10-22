import type { ReactNode } from 'react';

import { cn } from '@recoder/ui';

interface BriefProps {
	/** The sentence that matters, in full ink. */
	lead: ReactNode;
	/** What follows it, muted. */
	rest?: ReactNode;
	as?: 'p' | 'h1' | 'h2';
	className?: string;
}

/** A sentence or two in the AI voice: the queue headline, and the message a page shows when it has nothing else. */
export function Brief({ lead, rest, as: Tag = 'p', className }: BriefProps) {
	return (
		<Tag data-ui="brief" className={cn('ai-voice brief', className)}>
			<span className="text-fg">{lead}</span>
			{rest ? <> {rest}</> : null}
		</Tag>
	);
}
