import { Skeleton } from '@recoder/ui';

import { UsageBlock } from './usage-block';

const RAIL_ROWS = 4;
const FIGURES = 5;
const CALL_FIGURES = 3;
const KIND_ROWS = 3;
const BREAKDOWN_ROWS = 5;

/**
 * Stands in for the usage page while it loads: the same blocks at the same
 * sizes, so nothing moves when the report lands.
 */
export function UsageSkeleton() {
	return (
		<div className="usage-report usage-skeleton" aria-hidden>
			<div className="usage-overview">
				<div className="usage-rail">
					<div className="usage-total">
						<Skeleton className="usage-skeleton-total" />
						<Skeleton className="usage-skeleton-meta" />
					</div>
					<div className="usage-rail-list">
						{Array.from({ length: RAIL_ROWS }, (_, index) => (
							<div key={index} className="usage-rail-row">
								<Skeleton className="usage-skeleton-dot" />
								<Skeleton className="usage-skeleton-mark" />
								<Skeleton className="usage-skeleton-rail-name" />
								<Skeleton className="usage-skeleton-rail-tokens" />
								<Skeleton className="usage-skeleton-rail-meta" />
							</div>
						))}
					</div>
				</div>
				<div className="usage-plot">
					<h2 className="usage-block-title">Daily processed tokens</h2>
					<Skeleton className="usage-skeleton-chart" />
				</div>
			</div>
			<UsageBlock title="Totals">
				<FiguresSkeleton count={FIGURES} />
			</UsageBlock>
			<UsageBlock title="Tokens by type">
				<Skeleton className="usage-skeleton-bar" />
			</UsageBlock>
			<UsageBlock title="Model calls">
				<FiguresSkeleton count={CALL_FIGURES} />
			</UsageBlock>
			<UsageBlock title="By kind">
				<RowsSkeleton count={KIND_ROWS} />
			</UsageBlock>
			<UsageBlock title="Breakdown">
				<RowsSkeleton count={BREAKDOWN_ROWS} />
			</UsageBlock>
		</div>
	);
}

/** A row of `count` figures, each a label over its number. */
function FiguresSkeleton({ count }: { count: number }) {
	return (
		<div className="usage-figures">
			{Array.from({ length: count }, (_, index) => (
				<div key={index} className="usage-figure">
					<Skeleton className="usage-skeleton-label" />
					<Skeleton className="usage-skeleton-figure" />
				</div>
			))}
		</div>
	);
}

/** A table's head and `count` rows, each just a name. */
function RowsSkeleton({ count }: { count: number }) {
	return (
		<div className="usage-rows">
			<div className="usage-head" />
			{Array.from({ length: count }, (_, index) => (
				<div key={index} className="usage-row usage-skeleton-row">
					<Skeleton className="usage-skeleton-name" />
				</div>
			))}
		</div>
	);
}
