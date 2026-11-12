'use client';

import { Button } from '@recoder/ui/button';
import { StatusNotice } from '@recoder/ui/status-notice';

import { useReview } from '@/lib/review/review-store';

function toOverview(): void {
	useReview.getState().select({ kind: 'overview' });
}

/**
 * The reading pane for an item the review no longer has, such as a decision
 * a newer run dropped or a file outside the diff: what happened, and the way
 * back to the overview.
 */
export function MissingItem({ title, detail }: { title: string; detail: string }) {
	return (
		<StatusNotice
			title={title}
			detail={detail}
			actions={
				<Button variant="outline" onClick={toOverview}>
					Back to the overview
				</Button>
			}
			className="pane-notice"
		/>
	);
}
