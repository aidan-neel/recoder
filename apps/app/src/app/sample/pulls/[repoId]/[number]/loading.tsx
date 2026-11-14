import { Page } from '@/components/common/page';
import { PullPageSkeleton } from '@/components/pull/pull-skeleton';

/** The same loading skeleton the live pull request page carries, so the sample navigates the way the app does. */
export default function Loading() {
	return (
		<Page>
			<PullPageSkeleton />
		</Page>
	);
}
