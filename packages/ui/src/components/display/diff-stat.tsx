import { cn } from '../../lib/cn';

interface DiffStatProps {
	additions: number;
	deletions: number;
	className?: string;
}

/** Lines added and removed, as `+346 −58`. A side with nothing is left out, and both are when the change is empty. */
export function DiffStat({ additions, deletions, className }: DiffStatProps) {
	if (additions === 0 && deletions === 0) return null;

	return (
		<span data-ui="diff-stat" className={cn(className)} aria-label={`${additions} added, ${deletions} removed`}>
			{additions > 0 ? <span data-sign="add">+{additions.toLocaleString('en-US')}</span> : null}
			{deletions > 0 ? <span data-sign="del">−{deletions.toLocaleString('en-US')}</span> : null}
		</span>
	);
}
