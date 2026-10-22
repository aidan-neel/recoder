'use client';

import { ReadingPane } from '@/components/review/reading-pane';
import { ReviewHeader } from '@/components/review/review-header';
import { ReviewRail } from '@/components/review/review-rail';

/**
 * The sample review as the app's review page lays it out: the header, the
 * rail and the reading pane with its decision bar. It leaves out the page's
 * keys, its address and title sync and the ask column, so the site never
 * reacts to the visitor's keys and the demo never touches the address bar.
 * A selected rail row scrolls only the rail, so the site never moves.
 */
export function DemoReview() {
	return (
		<div data-ui="review-page" className="review-page">
			<ReviewHeader />
			<div className="review-body">
				<ReviewRail />
				<ReadingPane />
			</div>
		</div>
	);
}
