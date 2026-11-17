import { Skeleton } from '@recoder/ui';

import { UsageBlock } from '../usage/usage-block';
import { FiguresSkeleton, OverviewSkeleton, RowsSkeleton } from '../usage/usage-skeleton';

const PR_FIGURES = 5;
const FINDING_FIGURES = 5;
const BREAKDOWN_ROWS = 5;

/** Stands in for Settings → Telemetry while its report first loads. */
export function TelemetrySkeleton() {
	return (
		<div className="usage-report usage-skeleton" aria-hidden>
			<OverviewSkeleton chartTitle="Daily pull requests reviewed" />
			<UsageBlock title="Pull requests">
				<FiguresSkeleton count={PR_FIGURES} />
			</UsageBlock>
			<UsageBlock title="Findings">
				<FiguresSkeleton count={FINDING_FIGURES} />
			</UsageBlock>
			<UsageBlock title="Findings by severity">
				<Skeleton className="usage-skeleton-bar" />
			</UsageBlock>
			<UsageBlock title="Breakdown">
				<RowsSkeleton count={BREAKDOWN_ROWS} />
			</UsageBlock>
		</div>
	);
}
