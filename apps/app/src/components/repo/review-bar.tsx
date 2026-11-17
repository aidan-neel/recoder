import type { HTMLAttributes, Ref } from 'react';

import type { ReviewChart } from '@/lib/repo/types';

interface ReviewBarProps extends HTMLAttributes<HTMLSpanElement> {
	bar: ReviewChart['bars'][number];
	ref?: Ref<HTMLSpanElement>;
}

/**
 * One day of a reviews chart: the day's reviews as a bar, the part that found a bug in the high-severity colour, and
 * a low mark for a day with none. Its other props reach its slot, so a tooltip can hold it.
 */
export function ReviewBar({ bar, ...slot }: ReviewBarProps) {
	return (
		<span {...slot} className="repo-bar-slot">
			<span className="repo-bar" data-empty={bar.reviews === 0 || undefined} style={{ height: `${bar.height * 100}%` }}>
				{bar.withBugs > 0 ? <span className="repo-bar-bugs" style={{ height: `${bar.bugShare * 100}%` }} /> : null}
			</span>
		</span>
	);
}
