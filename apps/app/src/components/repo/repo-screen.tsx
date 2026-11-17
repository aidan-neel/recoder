'use client';

import { Button, Tooltip } from '@recoder/ui';
import { ArrowUpRight, MessageSquare, Plus } from 'lucide-react';
import Link from 'next/link';

import { useRepoPage } from '@/lib/repo/use-repo-page';
import type { RepoPageView } from '@/lib/repo/types';

import { Crumbs } from '@/components/common/crumbs';
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
							<ArrowUpRight />
						</a>
					</Button>
				</Tooltip>
			) : null}
			<Button asChild variant="outline">
				<Link href={view.newHref} onClick={view.prepareAsk}>
					<MessageSquare aria-hidden />
					Ask
				</Link>
			</Button>
			<Button asChild variant="primary">
				<Link href={view.newHref} onClick={view.prepareReview}>
					<Plus aria-hidden />
					New review
				</Link>
			</Button>
		</>
	);
}

/**
 * One tracked repository at a glance: what needs a person, how its reviews have gone over the last thirty days,
 * where its bugs land and what merged lately. It paints once everything is in, from a skeleton of the same shape.
 */
export function RepoScreen({ repoId }: { repoId: string }) {
	const view = useRepoPage(repoId);
	const { data } = view;

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
				{view.phase === 'loading' ? <RepoSkeleton /> : null}
				{view.phase === 'missing' || view.phase === 'failed' ? <RepoNotice view={view} /> : null}
				{data ? (
					<div className="repo-page">
						<RepoHeader repo={data.repo} figures={data.figures} />
						<div className="repo-columns">
							<RepoMain view={view} data={data} />
							<RepoSide data={data} />
						</div>
					</div>
				) : null}
			</div>
		</Page>
	);
}
