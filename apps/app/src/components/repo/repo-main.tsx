'use client';

import { HoverList, RowButton } from '@recoder/ui';
import { Link } from '@/components/common/link';

import type { MergedRow, RepoPageData, RepoPageView } from '@/lib/repo/types';

import { Age } from '@/components/common/age';
import { PullMark } from '@/components/common/pull-mark';
import { PullList } from '@/components/pulls/pull-list';

import { RepoEmpty, RepoSection } from './repo-section';

/** The pull requests that merged after a review: what the reviews fixed, and when it merged. */
function Merged({ rows }: { rows: MergedRow[] }) {
	if (rows.length === 0) return <RepoEmpty>No reviewed pull request has merged yet.</RepoEmpty>;

	return (
		<HoverList as="ul" className="repo-rows" itemSelector="[data-repo-row]" aria-label="Recently merged">
			{rows.map((row) => (
				<li key={row.key} data-repo-row className="repo-row">
					<RowButton asChild cover>
						<Link href={row.href} className="repo-row-link">
							<PullMark state="merged" />
							<span className="repo-row-title">{row.title}</span>
							<span className="repo-row-number">#{row.number}</span>
						</Link>
					</RowButton>
					<span className="meta repo-row-end">
						{row.outcome}
						<Age at={row.mergedAt} className="meta-sep" />
					</span>
				</li>
			))}
		</HoverList>
	);
}

/** The wide column: the open pull requests most urgent first, then what merged last. */
export function RepoMain({ view, data }: { view: RepoPageView; data: RepoPageData }) {
	const link = (
		<Link href={view.pullsHref} onClick={view.showPulls} className="meta text-link repo-section-link">
			{data.allPullsLabel}
		</Link>
	);

	return (
		<div className="repo-main">
			<RepoSection title="Needs you" aside={data.needsYou.length > 0 ? link : null} className="repo-needs">
				{data.needsYou.length > 0 ? (
					<PullList
						rows={data.needsYou}
						starting={view.starting}
						onReview={view.review}
						onWarm={view.warm}
						showRepo={false}
					/>
				) : (
					<RepoEmpty>No open pull requests.</RepoEmpty>
				)}
			</RepoSection>
			<RepoSection title="Recently merged">
				<Merged rows={data.merged} />
			</RepoSection>
		</div>
	);
}
