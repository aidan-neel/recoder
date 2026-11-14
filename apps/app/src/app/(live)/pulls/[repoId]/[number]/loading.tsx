import { Page } from '@/components/common/page';
import { PullPageSkeleton } from '@/components/pull/pull-skeleton';

/** A click on a pull request paints its skeleton while the screen loads; the screen keeps the same shape until its data lands. */
export default function Loading() {
	return (
		<Page>
			<PullPageSkeleton />
		</Page>
	);
}
