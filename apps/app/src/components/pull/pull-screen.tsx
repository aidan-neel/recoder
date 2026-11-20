'use client';

import type { PullPage } from '@recoder/shared';
import { Button, Skeleton } from '@recoder/ui';
import { ArrowUpRightIcon } from '@phosphor-icons/react';
import { useCallback, useState, type ReactNode } from 'react';

import { useApi } from '@/lib/api/client';
import type { BugView } from '@/lib/bugs/types';
import { useBugsView } from '@/lib/bugs/use-bugs';
import { useChangesNav } from '@/lib/changes/use-changes';
import { forgeLabel } from '@/lib/connections/forges';
import { LOADING_PULL_PAGE } from '@/lib/pull/loading-page';
import { PullSessionProvider, useMergeView, usePullChecksView, usePullPageView } from '@/lib/pull/pull-session';
import type { PullTab } from '@/lib/pull/types';
import { usePullTab } from '@/lib/pull/use-pull-tab';
import { isLive } from '@/lib/run/run-phase';
import { useRunView } from '@/lib/run/use-run';
import { replaceAddress } from '@/lib/shell/navigation';
import { pullHref, pullsHref, repoHref } from '@/lib/shell/routes';

import { BugsTab } from '@/components/bugs/bugs-tab';
import { BugsTools } from '@/components/bugs/bugs-tools';
import { ChangesTab } from '@/components/changes/changes-tab';
import { ChangesTools, type ChangesMode } from '@/components/changes/changes-tools';
import { CommitsTab } from '@/components/commits/commits-tab';
import { CancelReviewHost } from '@/components/common/cancel-review';
import { Crumbs } from '@/components/common/crumbs';
import { Page } from '@/components/common/page';
import { TokenUsageButton } from '@/components/common/token-usage-modal';
import { DescriptionTab } from '@/components/summary/description-tab';

import { ChecksList } from './checks';
import { MergeActions, MergeFacts } from './merge-facts';
import { PullHeader } from './pull-header';
import { PullNotice } from './pull-notice';
import { PullTabs } from './pull-tabs';
import { ReviewButton, reviewIsNext } from './review-button';

interface PullScreenProps {
	repoId: string;
	number: number;
}

interface PullOnTabProps extends PullScreenProps {
	/** The open tab. */
	tab: PullTab;
}

/** The Review tab's tools; they read the review, so they mount only on that tab. */
function ReviewTabTools() {
	return <BugsTools view={useBugsView()} run={useRunView()} />;
}

/**
 * The page's one Review button, then the menu and the merge button. The merge button is the page's primary only
 * once nothing is left to do first: with a review to run, findings to read or a review running it steps back to an
 * outline, so the one primary button in view is the next step.
 */
function PullActions({ page }: { page: PullPage }) {
	const run = useRunView();
	const merge = useMergeView();
	const bugs = useBugsView();
	const settled = !isLive(run.phase) && !reviewIsNext(run) && !(bugs.phase === 'ready' && bugs.open.length > 0);

	return (
		<>
			<ReviewButton run={run} />
			<MergeActions page={page} merge={merge} settled={settled} />
		</>
	);
}

/** The checks and the conflicts; they read the checks, so the title and facts never re-render for them. */
function PullMergeFacts({ page }: { page: PullPage }) {
	return <MergeFacts page={page} checks={usePullChecksView()} />;
}

/** The checks' list under the facts. */
function PullChecksList() {
	return <ChecksList view={usePullChecksView()} />;
}

/** The header while the page loads: a stand-in page with a button and a merge fact, for the skeleton to measure. */
function LoadingHeader() {
	return (
		<PullHeader
			page={LOADING_PULL_PAGE}
			actions={<Button variant="outline">Review</Button>}
			merge={
				<div className="merge-facts">
					<span className="merge-fact">3 checks passed</span>
				</div>
			}
		>
			{null}
		</PullHeader>
	);
}

/**
 * The page inside its session: the bar, the header with its merge facts, the tabs and the open tab. The tabs
 * come from the address, so they stand from the first frame; while the page loads, the header is a skeleton
 * measured from a stand-in page and the open tab shows its own.
 */
function PullFrame({ repoId, number, tab }: PullOnTabProps) {
	const { base } = useApi();
	const view = usePullPageView();
	const [mode, setMode] = useState<ChangesMode>('files');
	const nav = useChangesNav();
	const changesHref = pullHref(base, repoId, number, 'changes');
	const page = view.page;
	const forge = page && page.provider !== 'local' && page.pull.url ? forgeLabel(page.provider) : null;

	/** Opens the Changes tab in the guide's reading order. */
	function openGuide(): void {
		setMode('guide');
		replaceAddress(changesHref);
	}

	/** Opens the Changes tab at a changed file: the tab scrolls to it once the file's card is drawn. */
	const openFile = useCallback(
		(path: string) => {
			nav.goTo(path);
			replaceAddress(changesHref);
		},
		[nav, changesHref]
	);

	/** Opens the Changes tab at a finding, under its line. */
	const openFinding = useCallback(
		(bug: BugView) => {
			nav.goTo(bug.file, bug.line, bug.id);
			replaceAddress(changesHref);
		},
		[nav, changesHref]
	);

	const tools: Record<PullTab, ReactNode> = {
		changes: <ChangesTools mode={mode} onModeChange={setMode} />,
		description: null,
		review: <ReviewTabTools />,
		commits: null
	};

	const bodies: Record<PullTab, ReactNode> = {
		changes: <ChangesTab repoId={repoId} number={number} mode={mode} />,
		description: (
			<DescriptionTab
				onOpenGuide={openGuide}
				onOpenFile={openFile}
				onOpenFinding={openFinding}
				onOpenReview={() => replaceAddress(pullHref(base, repoId, number, 'review'))}
			/>
		),
		review: <BugsTab />,
		commits: <CommitsTab />
	};

	return (
		<CancelReviewHost>
			<Page
				start={
					<Crumbs
						parts={[
							{ label: 'Pull requests', href: pullsHref(base) },
							{ label: view.repoName, href: repoHref(base, repoId) },
							{ label: `#${number}` }
						]}
					/>
				}
				end={
					<>
						{view.reviewId ? <TokenUsageButton kind="review" id={view.reviewId} /> : null}
						{forge && page ? (
							<Button asChild variant="ghost" className="pull-forge-link">
								<a href={page.pull.url} target="_blank" rel="noreferrer">
									Open on {forge}
									<ArrowUpRightIcon aria-hidden className="size-3.5" />
								</a>
							</Button>
						) : null}
					</>
				}
			>
				{view.phase === 'not-found' || view.phase === 'failed' ? (
					<div className="page-notice">
						<PullNotice view={view} />
					</div>
				) : null}
				{page || view.phase === 'loading' ? (
					<>
						<Skeleton id="pull-head" loading={!page} className="pull-head-frame">
							{page ? (
								<PullHeader page={page} actions={<PullActions page={page} />} merge={<PullMergeFacts page={page} />}>
									<PullChecksList />
								</PullHeader>
							) : (
								<LoadingHeader />
							)}
						</Skeleton>
						<div className="page-column pull-tabs-row">
							<PullTabs repoId={repoId} number={number} tab={tab} counts={view.counts} />
							<div className="pull-tools">{tools[tab]}</div>
						</div>
						<div className="pull-body">{bodies[tab]}</div>
					</>
				) : null}
			</Page>
		</CancelReviewHost>
	);
}

/**
 * A pull request's page on `tab`. Everything under it reads one session for
 * this pull request; another pull request gets a fresh one.
 */
export function PullOnTab({ repoId, number, tab }: PullOnTabProps) {
	return (
		<PullSessionProvider key={`${repoId}#${number}`} repoId={repoId} number={number}>
			<PullFrame repoId={repoId} number={number} tab={tab} />
		</PullSessionProvider>
	);
}

/** A pull request's page on the tab its address names. */
export function PullScreen({ repoId, number }: PullScreenProps) {
	return <PullOnTab repoId={repoId} number={number} tab={usePullTab()} />;
}
