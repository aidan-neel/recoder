'use client';

import { Collapsible, CollapsibleContent, CollapsibleTrigger, RowButton } from '@recoder/ui';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

interface SidebarSectionProps {
	title: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	className: string;
	/** Beside the title, such as a count. */
	aside?: ReactNode;
	children: ReactNode;
}

/** A sidebar list under a title that folds it away: a click on the title opens or closes it. */
export function SidebarSection({ title, open, onOpenChange, className, aside, children }: SidebarSectionProps) {
	return (
		<Collapsible open={open} onOpenChange={onOpenChange} className={className}>
			<RowButton asChild className="section-head">
				<CollapsibleTrigger>
					<span className="section-label">{title}</span>
					{aside}
					<ChevronDown aria-hidden className="section-chevron" />
				</CollapsibleTrigger>
			</RowButton>
			<CollapsibleContent>{children}</CollapsibleContent>
		</Collapsible>
	);
}
