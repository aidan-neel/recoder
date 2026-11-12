'use client';

import { Button, SkeletonRows, StatusNotice } from '@recoder/ui';
import { useEffect, useState } from 'react';

import type { BugsView } from '@/lib/bugs/types';
import { useBugsView } from '@/lib/bugs/use-bugs';
import { useRunView } from '@/lib/run/use-run';
import { plural } from '@/lib/shell/format';
import { useKeys } from '@/lib/shell/use-keys';

import { RunBanner } from '@/components/pull/run-banner';

import { BugCard } from './bug-card';
import { BugGroups } from './bug-groups';
import { RunCard } from './run-card';

interface BugsTabProps {
	repoId: string;
	number: number;
}

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

/** What the tab says when a finished review has no open bugs. */
function CleanNotice({ view }: { view: BugsView }) {
	const detail =
		view.checked.claims > 0
			? `It checked ${plural(view.checked.claims, 'claim')} and none held.`
			: 'Nothing it looked at needs your attention.';

	return (
		<div className="page-notice">
			<StatusNotice title="Recoder found no bugs." detail={detail} />
		</div>
	);
}

/**
 * The Bugs tab: the open findings of the newest review as cards, the first
 * one open, then what else the review reports. While a review runs, its
 * progress shows above them. `j` and `k` step through the cards; Enter opens
 * the one focus rests on.
 */
export function BugsTab({ repoId, number }: BugsTabProps) {
	const view = useBugsView();
	const run = useRunView();
	const [open, toggle] = useOpenBugs(view);
	const busy = run.phase === 'queued' || run.phase === 'running';
	const settled = run.phase === 'passed' && !run.outdated;

	useKeys({ j: () => stepBug(1), k: () => stepBug(-1) });

	return (
		<div className="reading">
			<div className="reading-column">
				{busy ? <RunCard run={run} /> : null}
				{!busy && !settled ? (
					<RunBanner
						run={run}
						repoId={repoId}
						number={number}
						bugs={view.phase === 'ready' ? view.open.length : null}
					/>
				) : null}
				{view.phase === 'loading' ? <SkeletonRows count={3} height={52} glyph lines={1} /> : null}
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
				{view.phase === 'ready' && view.open.length === 0 && settled ? <CleanNotice view={view} /> : null}
				{view.phase === 'ready'
					? view.open.map((bug) => (
							<BugCard key={bug.id} bug={bug} view={view} open={open.has(bug.id)} onToggle={toggle} />
						))
					: null}
				{view.phase === 'ready' ? <BugGroups view={view} /> : null}
			</div>
		</div>
	);
}
