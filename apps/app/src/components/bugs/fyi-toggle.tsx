'use client';

import { Button, Icon, Tooltip } from '@recoder/ui';

import { useShowFyi } from '@/lib/bugs/show-fyi';

/**
 * Shows or hides the review's FYI notes, its commentary that is never a bug, wherever findings show. The choice is
 * kept in this browser. Nothing shows when the review left no FYI notes.
 */
export function FyiToggle({ count }: { count: number }) {
	const fyi = useShowFyi();

	if (count === 0) return null;

	const label = fyi.shown ? 'Hide FYI notes' : 'Show FYI notes';

	return (
		<Tooltip content={label}>
			<Button
				variant="quiet"
				size="sm"
				className="fyi-toggle"
				aria-pressed={fyi.shown}
				aria-label={label}
				onClick={fyi.toggle}
			>
				<Icon name="speaker_notes" />
				FYI
				<span className="meta tabular">{count}</span>
			</Button>
		</Tooltip>
	);
}
