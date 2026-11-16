'use client';

import { Button, Pill, Popover, PopoverContent, PopoverTrigger, Spinner, type PillTone } from '@recoder/ui';
import { Bug, Check, CircleAlert, Clock3, History, Pause } from 'lucide-react';
import { useState, type MouseEvent, type ReactNode } from 'react';

import type { RunView } from '@/lib/run/types';
import { runClock } from '@/lib/shell/age';
import { plural } from '@/lib/shell/format';
import { useNow } from '@/lib/shell/use-now';

import { RunBanner } from './run-banner';

interface Face {
	tone: PillTone;
	icon: ReactNode;
	label: string;
}

/** The badge for where the review stands; none before a review or after one was cancelled. */
function faceOf(run: RunView, bugs: number | null): Face | null {
	if (run.phase === 'queued') return { tone: 'neutral', icon: <Clock3 aria-hidden />, label: 'Queued' };
	if (run.phase === 'running') return { tone: 'low', icon: <Spinner size={12} />, label: 'Reviewing' };
	if (run.phase === 'paused') return { tone: 'neutral', icon: <Pause aria-hidden />, label: 'Paused' };
	if (run.phase === 'failed') return { tone: 'danger', icon: <CircleAlert aria-hidden />, label: 'Review failed' };
	if (run.phase !== 'passed') return null;
	if (run.outdated) return { tone: 'medium', icon: <History aria-hidden />, label: 'Review out of date' };

	return bugs
		? { tone: 'high', icon: <Bug aria-hidden />, label: plural(bugs, 'bug') }
		: { tone: 'ok', icon: <Check aria-hidden />, label: 'No bugs' };
}

/** The time a review has run, ticking each second. */
function Elapsed({ since }: { since: string }) {
	const now = useNow(1000);

	return <span className="review-badge-clock mono tabular">{runClock(now - Date.parse(since))}</span>;
}

interface ReviewStatusProps {
	run: RunView;
	repoId: string;
	number: number;
	/** Open findings of the finished review; null before one. */
	bugs: number | null;
}

/**
 * Where the newest review stands, as one badge beside the title. It opens the
 * review's banner in a popover, with the same next steps: see progress,
 * cancel, try again, review again. A link inside closes it.
 */
export function ReviewStatus({ run, repoId, number, bugs }: ReviewStatusProps) {
	const [open, setOpen] = useState(false);
	const face = faceOf(run, bugs);

	if (!face) return null;

	/** Closes the popover once a link inside it is followed. */
	function closeOnLink(event: MouseEvent<HTMLDivElement>): void {
		if (event.target instanceof Element && event.target.closest('a')) setOpen(false);
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger>
				<Button variant="quiet" className="review-badge" aria-label={`Review: ${face.label}`}>
					<Pill tone={face.tone} icon={face.icon}>
						{face.label}
						{run.phase === 'running' && run.startedAt ? <Elapsed since={run.startedAt} /> : null}
					</Pill>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="review-popover">
				<div onClickCapture={closeOnLink}>
					<RunBanner run={run} repoId={repoId} number={number} bugs={bugs} />
				</div>
			</PopoverContent>
		</Popover>
	);
}
