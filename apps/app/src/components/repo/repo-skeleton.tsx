import { Skeleton, SkeletonRows } from '@recoder/ui';

import { RepoSection } from './repo-section';

const FIGURES = 5;
const OPEN_ROWS = 5;
const MERGED_ROWS = 3;
const HOTSPOT_ROWS = 5;
const SETUP_ROWS = 2;

/**
 * Stands in for the repository page while it loads: the header, the figures and both columns at the sizes they
 * will have, so the page swaps in place with nothing moving.
 */
export function RepoSkeleton() {
	return (
		<div className="repo-page repo-skeleton" aria-hidden>
			<div className="repo-head">
				<div className="page-title repo-title">
					<Skeleton className="repo-skeleton-title" />
				</div>
				<div className="repo-facts">
					<Skeleton className="repo-skeleton-pill" />
					<Skeleton className="repo-skeleton-pill" />
				</div>
			</div>
			<div className="repo-figures">
				{Array.from({ length: FIGURES }, (_, index) => (
					<div key={index} className="repo-figure">
						<Skeleton className="repo-skeleton-label" />
						<Skeleton className="repo-skeleton-figure" />
					</div>
				))}
			</div>
			<div className="repo-columns">
				<div className="repo-main">
					<RepoSection title="Needs you">
						<SkeletonRows count={OPEN_ROWS} height={60} glyph className="pull-list-skeleton" />
					</RepoSection>
					<RepoSection title="Recently merged">
						<SkeletonRows
							count={MERGED_ROWS}
							height={36}
							lines={1}
							rowClassName="repo-row"
							className="repo-skeleton-rows"
						/>
					</RepoSection>
				</div>
				<div className="repo-side">
					<RepoSection title="Reviews, 30 days" className="repo-chart-section">
						<Skeleton className="repo-skeleton-chart" />
					</RepoSection>
					<RepoSection title="Where bugs land">
						<SkeletonRows
							count={HOTSPOT_ROWS}
							height={36}
							lines={1}
							rowClassName="repo-row"
							className="repo-skeleton-rows"
						/>
					</RepoSection>
					<RepoSection title="Set up here">
						<SkeletonRows
							count={SETUP_ROWS}
							height={36}
							lines={1}
							rowClassName="repo-row"
							className="repo-skeleton-rows"
						/>
					</RepoSection>
				</div>
			</div>
		</div>
	);
}
