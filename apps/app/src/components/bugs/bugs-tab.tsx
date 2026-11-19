'use client';

import { Button, Pill, SkeletonRows, StatusNotice } from '@recoder/ui';
import { ClockIcon, GitCommitIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import type { BugsView } from '@/lib/bugs/types';
import { useBugsView } from '@/lib/bugs/use-bugs';
import { shortSha } from '@/lib/files/ref-label';
import { usePullPageView } from '@/lib/pull/pull-session';
import { isLive } from '@/lib/run/run-phase';
import { useRunView } from '@/lib/run/use-run';
import { useKeys } from '@/lib/shell/use-keys';
import { useReviewArriving } from '@/lib/summary/use-review-arriving';

import { Age } from '@/components/common/age';
import { RunBanner } from '@/components/pull/run-banner';

import { BugCard } from './bug-card';
import { BugGroups } from './bug-groups';
import { CleanNotice } from './clean-notice';
import { RunSteps } from './run-steps';

/** The bug the address points at (`#bug-<id>`), when it names one. */
function bugInAddress(): string | null {
	const match = /^#bug-(.+)$/.exec(location.hash);

	return match ? decodeURIComponent(match[1]) : null;
}

/** The heads of the bug cards on the page, top to bottom. */
function bugHeads(): HTMLElement[] {
	return [...document.querySelectorAll<HTMLElement>('.bug-item > .bug-head')];
}

/** Moves focus `by` cards from the focused one; with none focused, to the first or the last. */
function stepBug(by: 1 | -1): void {
	const heads = bugHeads();
	const at = heads.findIndex((head) => head === document.activeElement);
	const resting = by === 1 ? 0 : heads.length - 1;
	const next = at === -1 ? resting : Math.min(heads.length - 1, Math.max(0, at + by));

	heads[next]?.focus();
	heads[next]?.scrollIntoView({ block: 'nearest' });
}

/**
 * Which bug cards are open. The bug the address names (`#bug-<id>`) starts
 * open and scrolls into view once the bugs are there; with none named, the
 * first open bug starts open.
 */
function useOpenBugs(view: BugsView): [ReadonlySet<string>, (id: string) => void] {
	const [named] = useState(bugInAddress);
	const [open, setOpen] = useState<ReadonlySet<string> | null>(null);
	const start = named ?? view.open[0]?.id;
	const ready = view.phase === 'ready';

	if (ready && open === null) setOpen(new Set(start ? [start] : []));

	useEffect(() => {
		if (ready && named) document.getElementById(`bug-${named}`)?.scrollIntoView({ block: 'start' });
	}, [ready, named]);

	/** Opens a shut card, shuts an open one. */
	function toggle(id: string): void {
		setOpen((current) => {
			const next = new Set(current);

			if (!next.delete(id)) next.add(id);

			return next;
		});
	}

	return [open ?? new Set<string>(), toggle];
}

interface PreviousFindingsProps {
	view: BugsView;
	open: ReadonlySet<string>;
	onToggle: (id: string) => void;
}

/**
 * The findings of the review before the one that runs now, under its steps:
 * named as the previous review, stepped back, and with nothing to act on, so
 * they read as what was found last time and never as current.
 */
function PreviousFindings({ view, open, onToggle }: PreviousFindingsProps) {
	if (!view.previous || view.previous.open.length === 0) return null;

	return (
		<section className="bugs-previous" aria-label="Previous review">
			<div className="bugs-previous-head">
				<h2 className="section-label">Previous review</h2>
				{view.previous.headSha ? (
					<Pill face="code" icon={<GitCommitIcon aria-hidden />} title={view.previous.headSha}>
						{shortSha(view.previous.headSha)}
					</Pill>
				) : null}
				{view.previous.reviewedAt ? (
					<Pill icon={<ClockIcon aria-hidden />}>
						<Age at={view.previous.reviewedAt} form="long" />
					</Pill>
				) : null}
				<span className="meta bugs-previous-note">Replaced when this review finishes</span>
			</div>
			{view.previous.open.map((bug) => (
				<BugCard key={bug.id} bug={bug} view={view} open={open.has(bug.id)} onToggle={onToggle} place="review" stale />
			))}
		</section>
	);
}

/**
 * The Review tab: the open findings of the newest review as cards, the first
 * one open, then what else the review reports. While a review is queued,
 * runs or is paused, its steps show as rows above the last review's findings,
 * which stay to read until the new one lands; a review that failed,
 * is out of date or is not there yet says so in a banner with its next step.
 * `j` and `k` step through the cards; Enter opens the one focus rests on.
 * Until the page and the review's record arrive, rows of bars stand in, so
 * the tab never says there is no review before it knows.
 */
export function BugsTab() {
	const view = useBugsView();
	const run = useRunView();
	const [open, toggle] = useOpenBugs(view);
	const reviewArriving = useReviewArriving();
	const arriving = usePullPageView().phase === 'loading' || reviewArriving;
	const settled = run.phase === 'passed' && !run.outdated;
	const clean = view.phase === 'ready' && view.open.length === 0 && settled;

	useKeys({ j: () => stepBug(1), k: () => stepBug(-1) });

	return (
		<div className="reading">
			<div className="page-column reading-column">
				{isLive(run.phase) ? (
					<>
						<RunSteps run={run} />
						<PreviousFindings view={view} open={open} onToggle={toggle} />
					</>
				) : null}
				{!isLive(run.phase) && !arriving ? (
					<RunBanner run={run} bugs={view.phase === 'ready' ? view.open.length : null} />
				) : null}
				{view.phase === 'loading' || arriving ? <SkeletonRows count={3} height={36} glyph lines={1} /> : null}
				{view.phase === 'failed' ? (
					<div className="page-notice">
						<StatusNotice
							tone="danger"
							title="The review did not load."
							detail={view.error}
							actions={<Button onClick={() => location.reload()}>Reload</Button>}
						/>
					</div>
				) : null}
				{clean ? <CleanNotice checked={view.checked} /> : null}
				{view.phase === 'ready'
					? view.open.map((bug) => (
							<BugCard key={bug.id} bug={bug} view={view} open={open.has(bug.id)} onToggle={toggle} place="review" />
						))
					: null}
				{view.phase === 'ready' ? <BugGroups view={view} clean={clean} /> : null}
			</div>
		</div>
	);
}
