'use client';

import { Button } from '@recoder/ui';
import { ArrowUpRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { useApi } from '@/lib/api/client';
import { useBugsView } from '@/lib/bugs/use-bugs';
import { useViewedFiles } from '@/lib/changes/use-changes';
import { forgeLabel } from '@/lib/connections/forges';
import { PullSessionProvider, useMergeView, usePullChecksView, usePullPageView } from '@/lib/pull/pull-session';
import type { PullTab } from '@/lib/pull/types';
import { usePullTab } from '@/lib/pull/use-pull-tab';
import { useRunView } from '@/lib/run/use-run';
import { pullHref, pullsHref } from '@/lib/shell/routes';

import { BugsTab } from '@/components/bugs/bugs-tab';
import { BugsTools } from '@/components/bugs/bugs-tools';
import { ChangesTab } from '@/components/changes/changes-tab';
import { ChangesTools, type ChangesMode } from '@/components/changes/changes-tools';
import { CommitsTab } from '@/components/commits/commits-tab';
import { CancelReviewHost } from '@/components/common/cancel-review';
import { Crumbs } from '@/components/common/crumbs';
import { Page } from '@/components/common/page';
import { SummaryTab } from '@/components/summary/summary-tab';

import { MergeStrip } from './merge-strip';
import { PullHeader } from './pull-header';
import { PullPageSkeleton } from './pull-skeleton';
import { PullNotice } from './pull-notice';
import { PullTabs } from './pull-tabs';

interface PullScreenProps {
	repoId: string;
	number: number;
}

interface PullOnTabProps extends PullScreenProps {
	/** The open tab. */
	tab: PullTab;
}

/** The Bugs tab's tools; they read the review, so they mount only on that tab. */
function BugsTabTools() {
	return <BugsTools view={useBugsView()} run={useRunView()} />;
}

/** The Changes tab's tools; they read the viewed files, so they mount only on that tab. */
function ChangesTabTools({ mode, onModeChange }: { mode: ChangesMode; onModeChange: (mode: ChangesMode) => void }) {
	return <ChangesTools viewed={useViewedFiles()} mode={mode} onModeChange={onModeChange} />;
}

/** The merge strip; it reads the checks and the review, so the title and facts above never re-render for them. */
function PullMergeStrip() {
	const view = usePullPageView();
	const checks = usePullChecksView();
	const merge = useMergeView();
	const bugs = useBugsView();

	if (!view.page) return null;

	return (
		<MergeStrip
			page={view.page}
			checks={checks}
			merge={merge}
			bugs={bugs.phase === 'ready' ? bugs.open.length : null}
		/>
	);
}

/** The page inside its session: the bar, the header with its merge strip, the tabs and the open tab. */
function PullFrame({ repoId, number, tab }: PullOnTabProps) {
	const router = useRouter();
	const { base } = useApi();
	const view = usePullPageView();
	const [mode, setMode] = useState<ChangesMode>('files');
	const page = view.page;
	const forge = page && page.provider !== 'local' && page.pull.url ? forgeLabel(page.provider) : null;

	/** Opens the Changes tab in the guide's reading order. */
	function openGuide(): void {
		setMode('guide');
		router.replace(pullHref(base, repoId, number, 'changes'), { scroll: false });
	}

	const tools: Record<PullTab, ReactNode> = {
		changes: <ChangesTabTools mode={mode} onModeChange={setMode} />,
		summary: null,
		bugs: <BugsTabTools />,
		commits: null
	};

	const bodies: Record<PullTab, ReactNode> = {
		changes: <ChangesTab repoId={repoId} number={number} mode={mode} />,
		summary: <SummaryTab repoId={repoId} number={number} onOpenGuide={openGuide} />,
		bugs: <BugsTab repoId={repoId} number={number} />,
		commits: <CommitsTab />
	};

	return (
		<CancelReviewHost>
			<Page
				start={
					<Crumbs
						parts={[
							{ label: 'Pull requests', href: pullsHref(base) },
							{ label: view.repoName },
							{ label: `#${number}` }
						]}
					/>
				}
				end={
					forge && page ? (
						<Button asChild variant="ghost" className="pull-forge-link">
							<a href={page.pull.url} target="_blank" rel="noreferrer">
								Open on {forge}
								<ArrowUpRight aria-hidden className="size-3.5" />
							</a>
						</Button>
					) : null
				}
			>
				{view.phase === 'loading' ? <PullPageSkeleton /> : null}
				{view.phase === 'not-found' || view.phase === 'failed' ? (
					<div className="page-notice">
						<PullNotice view={view} />
					</div>
				) : null}
				{page ? (
					<>
						<PullHeader page={page}>
							<PullMergeStrip />
						</PullHeader>
						<div className="pull-tabs-row">
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
