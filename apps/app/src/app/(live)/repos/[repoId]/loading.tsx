import { Page } from '@/components/common/page';
import { RepoSkeleton } from '@/components/repo/repo-skeleton';

/** A click on a repository paints its skeleton while the screen loads; the screen keeps the same shape until its data lands. */
export default function Loading() {
	return (
		<Page>
			<div className="page-scroll">
				<RepoSkeleton />
			</div>
		</Page>
	);
}
