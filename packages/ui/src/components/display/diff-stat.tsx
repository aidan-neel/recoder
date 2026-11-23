import { cn } from '../../lib/cn';

/** One formatter for every count: `toLocaleString` with a locale builds a new one per call, which a 300-file list feels. */
const COUNT = new Intl.NumberFormat('en-US');

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
			{additions > 0 ? <span data-sign="add">+{COUNT.format(additions)}</span> : null}
			{deletions > 0 ? <span data-sign="del">−{COUNT.format(deletions)}</span> : null}
		</span>
	);
}
