'use client';

import { Button, Skeleton, Tooltip } from '@recoder/ui';
import { ArrowUpRightIcon, ChatIcon, PlusIcon } from '@phosphor-icons/react';

import { useRepoPage } from '@/lib/repo/use-repo-page';
import { useAfterPaint } from '@/lib/shell/use-after-paint';
import type { RepoPageView } from '@/lib/repo/types';

import { Crumbs } from '@/components/common/crumbs';
import { Link } from '@/components/common/link';
import { Page } from '@/components/common/page';

import { RepoHeader } from './repo-header';
import { RepoMain } from './repo-main';
import { RepoNotice } from './repo-notice';
import { RepoSide } from './repo-side';
import { RepoSkeleton } from './repo-skeleton';

/** The bar's actions: open the repository on its forge, ask about it, or start a review in it. */
function RepoActions({ view }: { view: RepoPageView }) {
	const forge = view.data?.repo.forge ?? null;

	return (
		<>
			{forge ? (
				<Tooltip content={`Open on ${forge.label}`}>
					<Button asChild variant="ghost" size="icon" aria-label={`Open on ${forge.label}`}>
						<a href={forge.url} target="_blank" rel="noreferrer">
							<ArrowUpRightIcon />
						</a>
					</Button>
				</Tooltip>
			) : null}
			<Button asChild variant="outline">
				<Link href={view.newHref} onClick={view.prepareAsk}>
					<ChatIcon aria-hidden />
					Ask
				</Link>
			</Button>
			<Tooltip content="New review" shortcut="c">
				<Button asChild variant="primary" size="icon">
					<Link href={view.newHref} onClick={view.prepareReview} aria-label="New review">
						<PlusIcon aria-hidden />
					</Link>
				</Button>
			</Tooltip>
		</>
	);
}

/**
 * One tracked repository at a glance: what needs a person, how its reviews have gone over the last thirty days,
 * where its bugs land and what merged lately. It paints once everything is in, from a skeleton of the same shape,
 * which mounts a frame after the page does so the click that opened it paints without the skeleton's cost.
 */
export function RepoScreen({ repoId }: { repoId: string }) {
	const view = useRepoPage(repoId);
	const painted = useAfterPaint();
	const { data } = view;
	const loading = view.phase === 'loading' && painted;

	return (
		<Page
			start={
				<Crumbs
					parts={[{ label: 'Repositories', href: view.reposHref }, ...(view.name ? [{ label: view.name }] : [])]}
				/>
			}
			end={view.phase === 'missing' ? null : <RepoActions view={view} />}
		>
			<div className="page-scroll">
				{view.phase === 'missing' || view.phase === 'failed' ? <RepoNotice view={view} /> : null}
				<Skeleton id="repo-page" loading={loading}>
					{loading ? <RepoSkeleton /> : null}
					{data ? (
						<div className="repo-page">
							<RepoHeader repo={data.repo} figures={data.figures} />
							<div className="repo-columns">
								<RepoMain view={view} data={data} />
								<RepoSide data={data} />
							</div>
						</div>
					) : null}
				</Skeleton>
			</div>
		</Page>
	);
}
