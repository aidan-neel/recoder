'use client';

import { HoverList, Pill, RowButton, StatusNotice, ForgeMark } from '@recoder/ui';

import { joinNames } from '@/lib/shell/format';
import type { PersonPageData, PersonPageView } from '@/lib/people/types';

import { Link } from '@/components/common/link';
import { PullList } from '@/components/pulls/pull-list';
import { Merged } from '@/components/repo/repo-main';
import { RepoEmpty, RepoSection } from '@/components/repo/repo-section';

const REVIEW_TONES = { high: 'high', medium: 'medium', ok: 'ok', danger: 'danger', neutral: 'neutral' } as const;

/** The wide column: their open pull requests as the list draws them, then what merged lately. */
export function PersonMain({ view, data }: { view: PersonPageView; data: PersonPageData }) {
	return (
		<div className="repo-main">
			{data.failures.length > 0 ? (
				<StatusNotice
					variant="inline"
					tone="danger"
					title={`${joinNames(data.failures)} did not answer, so their pull requests are left out.`}
				/>
			) : null}
			<RepoSection title="Open pull requests">
				{data.open.length > 0 ? (
					<PullList rows={data.open} starting={view.starting} onReview={view.review} onWarm={view.warm} />
				) : (
					<RepoEmpty>No open pull requests in the tracked repositories.</RepoEmpty>
				)}
			</RepoSection>
			<RepoSection title="Recently merged" aside={<span className="meta">{data.window}</span>}>
				{data.merged.length > 0 ? (
					<Merged rows={data.merged} />
				) : (
					<RepoEmpty>{`Nothing merged in ${data.window}.`}</RepoEmpty>
				)}
			</RepoSection>
		</div>
	);
}

/** The narrow column: the repositories they work in, and the reviews they ran. */
export function PersonSide({ data }: { data: PersonPageData }) {
	return (
		<div className="repo-side">
			<RepoSection title="Repositories" aside={<span className="meta">{data.window}</span>}>
				{data.repos.length > 0 ? (
					<HoverList as="ul" className="repo-rows" itemSelector="[data-repo-row]" aria-label="Repositories">
						{data.repos.map((repo) => (
							<li key={repo.repoId} data-repo-row className="repo-row">
								<RowButton asChild cover>
									<Link href={repo.href} className="repo-row-link">
										<ForgeMark provider={data.person.provider} aria-hidden className="person-row-mark" />
										<span className="repo-row-title">{repo.name}</span>
									</Link>
								</RowButton>
								<span className="meta repo-row-end">{repo.pulls}</span>
							</li>
						))}
					</HoverList>
				) : (
					<RepoEmpty>{`No pull requests in ${data.window}.`}</RepoEmpty>
				)}
			</RepoSection>
			<RepoSection title="Reviews run">
				{data.reviews.length > 0 ? (
					<HoverList as="ul" className="repo-rows" itemSelector="[data-repo-row]" aria-label="Reviews run">
						{data.reviews.map((review) => (
							<li key={review.id} data-repo-row className="repo-row">
								<RowButton asChild cover>
									<Link href={review.href} className="repo-row-link">
										<span className="repo-row-title">{review.title}</span>
										<span className="repo-row-number">{review.ref}</span>
									</Link>
								</RowButton>
								<Pill tone={REVIEW_TONES[review.tone]} className="repo-row-end">
									{review.outcome}
								</Pill>
							</li>
						))}
					</HoverList>
				) : (
					<RepoEmpty>
						{data.accountId || data.standing.tone === 'ok'
							? 'No reviews run yet.'
							: 'Only people on this server run reviews.'}
					</RepoEmpty>
				)}
			</RepoSection>
		</div>
	);
}
