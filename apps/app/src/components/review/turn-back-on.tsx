'use client';

import { Button } from '@recoder/ui';

import { useReview } from '@/lib/review/review-store';
import { useAction } from '@/lib/shell/use-action';

import { focusReadingPane } from './reading-viewport';

/** The rail's selected row, its one Tab stop. */
const SELECTED_ROW = '[data-ui="review-rail"] [data-rail-row][data-selected="true"]';

/**
 * Once the topic is back on, its quieted row goes and takes the focused
 * button with it, so focus lands on the rail's selected row when the button
 * sat in the rail, or else on the reading pane, never on the page.
 */
function keepFocus(inRail: boolean): void {
	requestAnimationFrame(() => {
		if (document.activeElement !== document.body) return;

		const row = inRail ? document.querySelector<HTMLElement>(SELECTED_ROW) : null;

		if (row) row.focus({ preventScroll: true });
		else focusReadingPane();
	});
}

interface TurnBackOnProps {
	topicId: string;
	/** The id of the element that names the topic, which describes the button. */
	describedBy?: string;
}

/**
 * Turns a quieted topic back on: a spinner of the same width while the server
 * answers, then its findings join the review and a toast says so, or the
 * button says Try again for a moment after the failure's toast.
 */
export function TurnBackOn({ topicId, describedBy }: TurnBackOnProps) {
	const action = useAction();

	return (
		<Button
			variant="ghost"
			status={action.status}
			aria-describedby={describedBy}
			onClick={(event) => {
				const inRail = event.currentTarget.closest('[data-ui="review-rail"]') !== null;

				action.run(async () => {
					await useReview.getState().turnTopicBackOn(topicId);
					keepFocus(inRail);
				});
			}}
		>
			Turn back on
		</Button>
	);
}
