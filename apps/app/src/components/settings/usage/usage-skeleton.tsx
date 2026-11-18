import { SkeletonBox } from '@recoder/ui';

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
			<OverviewSkeleton chartTitle="Daily processed tokens" />
			<UsageBlock title="Totals">
				<FiguresSkeleton count={FIGURES} />
			</UsageBlock>
			<UsageBlock title="Tokens by type">
				<SkeletonBox className="usage-skeleton-bar" />
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

/** Placeholder for the left rail + daily line chart overview block. */
export function OverviewSkeleton({ chartTitle }: { chartTitle: string }) {
	return (
		<div className="usage-overview">
			<div className="usage-rail">
				<div className="usage-total">
					<SkeletonBox className="usage-skeleton-total" />
					<SkeletonBox className="usage-skeleton-meta" />
				</div>
				<div className="usage-rail-list">
					{Array.from({ length: RAIL_ROWS }, (_, index) => (
						<div key={index} className="usage-rail-row">
							<SkeletonBox className="usage-skeleton-dot" />
							<SkeletonBox className="usage-skeleton-mark" />
							<SkeletonBox className="usage-skeleton-rail-name" />
							<SkeletonBox className="usage-skeleton-rail-tokens" />
							<SkeletonBox className="usage-skeleton-rail-meta" />
						</div>
					))}
				</div>
			</div>
			<div className="usage-plot">
				<h2 className="usage-block-title">{chartTitle}</h2>
				<SkeletonBox className="usage-skeleton-chart" />
			</div>
		</div>
	);
}

/** A row of `count` figures, each a label over its number. */
export function FiguresSkeleton({ count }: { count: number }) {
	return (
		<div className="usage-figures">
			{Array.from({ length: count }, (_, index) => (
				<div key={index} className="usage-figure">
					<SkeletonBox className="usage-skeleton-label" />
					<SkeletonBox className="usage-skeleton-figure" />
				</div>
			))}
		</div>
	);
}

/** A table's head and `count` rows, each just a name. */
export function RowsSkeleton({ count }: { count: number }) {
	return (
		<div className="usage-rows">
			<div className="usage-head" />
			{Array.from({ length: count }, (_, index) => (
				<div key={index} className="usage-row usage-skeleton-row">
					<SkeletonBox className="usage-skeleton-name" />
				</div>
			))}
		</div>
	);
}
