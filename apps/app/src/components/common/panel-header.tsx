import type { ReactNode } from 'react';

import { cn } from '@recoder/ui';

/** A 44px header row with a hairline under it, the same height everywhere so borders line up across panels. */
export function PanelHeader({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div
			data-ui="panel-header"
			className={cn('flex h-[44px] shrink-0 items-center gap-2 border-b border-line-divider px-4', className)}
		>
			{children}
		</div>
	);
}
