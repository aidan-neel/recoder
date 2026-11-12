import { cn } from '@recoder/ui';

interface DiffStatProps {
	additions: number;
	deletions: number;
	className?: string;
}

/** A count with thousands separators: `2,418`. */
function count(value: number): string {
	return value.toLocaleString('en-US');
}

/** Lines added and removed, as `+346 −58`. A side with nothing is left out, and both are when the change is empty. */
export function DiffStat({ additions, deletions, className }: DiffStatProps) {
	if (additions === 0 && deletions === 0) return null;

	return (
		<span className={cn('diff-stat', className)} aria-label={`${additions} added, ${deletions} removed`}>
			{additions > 0 ? <span data-sign="add">+{count(additions)}</span> : null}
			{deletions > 0 ? <span data-sign="del">−{count(deletions)}</span> : null}
		</span>
	);
}
