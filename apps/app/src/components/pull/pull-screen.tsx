'use client';

import { Button, Skeleton } from '@recoder/ui';
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
import { Crumbs } from '@/components/common/crumbs';
import { Page } from '@/components/common/page';
import { SummaryTab } from '@/components/summary/summary-tab';

import { MergeBar } from './merge-bar';
import { PullHeader } from './pull-header';
import { PullNotice } from './pull-notice';
import { PullTabs } from './pull-tabs';

interface PullScreenProps {
	repoId: string;
	number: number;
}

/** Bars where the title, the facts and the tabs will stand while the page loads. */
function HeadSkeleton() {
	return (
		<div className="pull-head-skeleton" aria-hidden>
			<Skeleton className="h-5 w-[420px] max-w-full" />
			<Skeleton className="h-3 w-[300px] max-w-full" />
			<Skeleton className="mt-2 h-3 w-[260px] max-w-full" />
		</div>
	);
}

/** The Bugs tab's tools; they read the review, so they mount only on that tab. */
function BugsTabTools() {
	return <BugsTools view={useBugsView()} run={useRunView()} />;
}

/** The Changes tab's tools; they read the viewed files, so they mount only on that tab. */
function ChangesTabTools({ mode, onModeChange }: { mode: ChangesMode; onModeChange: (mode: ChangesMode) => void }) {
	return <ChangesTools viewed={useViewedFiles()} mode={mode} onModeChange={onModeChange} />;
}

/** The merge bar; it reads the checks and the review, so the header above never re-renders for them. */
function PullMergeBar() {
	const view = usePullPageView();
	const checks = usePullChecksView();
	const merge = useMergeView();
	const bugs = useBugsView();

	if (!view.page) return null;

	return (
		<MergeBar page={view.page} checks={checks} merge={merge} bugs={bugs.phase === 'ready' ? bugs.open.length : null} />
	);
}

/** The page inside its session: the bar, the header, the tabs, the open tab and the merge bar. */
function PullFrame({ repoId, number }: PullScreenProps) {
	const router = useRouter();
	const { base } = useApi();
	const view = usePullPageView();
	const tab = usePullTab();
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
		<Page
			start={
				<Crumbs
					parts={[{ label: 'Pull requests', href: pullsHref(base) }, { label: view.repoName }, { label: `#${number}` }]}
				/>
			}
			end={
				forge && page ? (
					<Button asChild variant="ghost">
						<a href={page.pull.url} target="_blank" rel="noreferrer">
							Open on {forge}
							<ArrowUpRight aria-hidden className="size-3.5" />
						</a>
					</Button>
				) : null
			}
		>
			{view.phase === 'loading' ? <HeadSkeleton /> : null}
			{view.phase === 'not-found' || view.phase === 'failed' ? (
				<div className="page-notice">
					<PullNotice view={view} />
				</div>
			) : null}
			{page ? (
				<>
					<PullHeader page={page} />
					<div className="page-tabs-row">
						<PullTabs repoId={repoId} number={number} tab={tab} counts={view.counts} />
						<div className="pull-tools">{tools[tab]}</div>
					</div>
					<div className="pull-body">{bodies[tab]}</div>
					<PullMergeBar />
				</>
			) : null}
		</Page>
	);
}

/** A pull request's page. Everything under it reads one session for this pull request; another pull request gets a fresh one. */
export function PullScreen({ repoId, number }: PullScreenProps) {
	return (
		<PullSessionProvider key={`${repoId}#${number}`} repoId={repoId} number={number}>
			<PullFrame repoId={repoId} number={number} />
		</PullSessionProvider>
	);
}
