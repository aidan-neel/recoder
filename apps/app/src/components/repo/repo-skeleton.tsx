import { SkeletonBox, SkeletonRows } from '@recoder/ui';

import { LoadingPullRows } from '@/components/pulls/pull-list';

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
					<SkeletonBox className="repo-skeleton-title" />
				</div>
				<div className="repo-facts">
					<SkeletonBox className="repo-skeleton-pill" />
					<SkeletonBox className="repo-skeleton-pill" />
				</div>
			</div>
			<div className="repo-figures">
				{Array.from({ length: FIGURES }, (_, index) => (
					<div key={index} className="repo-figure">
						<SkeletonBox className="repo-skeleton-label" />
						<SkeletonBox className="repo-skeleton-figure" />
					</div>
				))}
			</div>
			<div className="repo-columns">
				<div className="repo-main">
					<RepoSection title="Needs you">
						<LoadingPullRows count={OPEN_ROWS} showRepo={false} />
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
						<SkeletonBox className="repo-skeleton-chart" />
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
