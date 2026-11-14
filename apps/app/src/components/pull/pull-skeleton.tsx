import { Skeleton } from '@recoder/ui';

/** Bars where the title, the facts, the merge strip and the tabs will stand while the page loads. */
export function PullPageSkeleton() {
	return (
		<div aria-hidden>
			<div className="pull-head pull-head-skeleton">
				<Skeleton className="h-5 w-[420px] max-w-full" />
				<Skeleton className="h-5 w-[320px] max-w-full" />
				<Skeleton className="h-10 w-full" />
			</div>
			<div className="pull-tabs-row">
				<Skeleton className="h-4 w-[260px] max-w-full" />
			</div>
		</div>
	);
}
