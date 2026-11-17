import { cn } from '@recoder/ui';

import { formatCount } from '@/lib/shell/format';

interface DiffStatProps {
	additions: number;
	deletions: number;
	className?: string;
}

/** Lines added and removed, as `+346 −58`. A side with nothing is left out, and both are when the change is empty. */
export function DiffStat({ additions, deletions, className }: DiffStatProps) {
	if (additions === 0 && deletions === 0) return null;

	return (
		<span className={cn('diff-stat', className)} aria-label={`${additions} added, ${deletions} removed`}>
			{additions > 0 ? <span data-sign="add">+{formatCount(additions)}</span> : null}
			{deletions > 0 ? <span data-sign="del">−{formatCount(deletions)}</span> : null}
		</span>
	);
}
