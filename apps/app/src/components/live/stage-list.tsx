'use client';

import {
	cn,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	DURATION,
	EASE_OUT,
	RowButton,
	Skeleton,
	StatusGlyph
} from '@recoder/ui';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion, type Transition } from 'motion/react';
import { useState } from 'react';

import type { ReviewerRow } from '@/lib/live/reviewers';
import { formatDuration, type StageTime } from '@/lib/live/stage-times';
import { isCurrent, type StageRow, type StageState } from '@/lib/live/stages';
import { useNow } from '@/lib/shell/use-now';

import { ReviewerList } from './reviewer-list';
import { SwapLine } from './swap-line';

/** A stage joining or leaving the timeline unfolds its height. */
const UNFOLD: Transition = { duration: DURATION.toggle, ease: EASE_OUT };

const STATE_LABEL: Record<StageState, string> = {
	idle: 'Not started',
	active: 'Running',
	paused: 'Paused',
	done: 'Done'
};

/** Widths of the placeholder rows' two lines, so they read as labels and notes of different lengths. */
const SKELETON_ROWS = [
	['w-[16%]', 'w-[48%]'],
	['w-[20%]', 'w-[56%]'],
	['w-[14%]', 'w-[40%]'],
	['w-[18%]', 'w-[52%]'],
	['w-[15%]', 'w-[44%]']
];

/** One stage's place on the timeline: what it is, how it stands, and the reviewers that work in it. */
export interface TimelineStage {
	row: StageRow;
	note: string;
	time: StageTime;
	/** The reviewers this stage runs, for Review and Subagents (empty until the plan names them); null for the rest. */
	reviewers: ReviewerRow[] | null;
}

/** The running stage's clock, counting up each second. */
function Elapsed({ since }: { since: number }) {
	const now = useNow(1000);

	return <span className="live-stage-time tabular">{formatDuration(Math.max(0, now - since))}</span>;
}

/** How long a finished stage took, or how long the running one has run; nothing for a stage not started. */
function StageClock({ time }: { time: StageTime }) {
	if (time.took !== null) return <span className="live-stage-time tabular">{formatDuration(time.took)}</span>;
	if (time.since !== null) return <Elapsed since={time.since} />;

	return null;
}

/**
 * The stage's name. A stage with reviewers that is not the current one opens
 * and closes them from its name, which covers the whole head as one button.
 */
function StageName({ row, toggles, open }: { row: StageRow; toggles: boolean; open: boolean }) {
	if (!toggles) return <span className="live-stage-label">{row.label}</span>;

	return (
		<RowButton asChild cover className="live-stage-label live-stage-toggle">
			<CollapsibleTrigger>
				{row.label}
				<ChevronDown data-open={open} className="live-stage-chevron" aria-hidden />
			</CollapsibleTrigger>
		</RowButton>
	);
}

/** The glyph on the rail, and the rail's segment down to the next stage. */
function Rail({ row }: { row: StageRow }) {
	return (
		<div className="live-stage-rail">
			<StatusGlyph kind={row.glyph} label={STATE_LABEL[row.state]} />
			<span aria-hidden className="live-stage-line" />
		</div>
	);
}

/**
 * One stage: its glyph on the rail, its name and time, and a line on what it
 * did, does or will do. The current stage opens its reviewers by height; a
 * finished one folds them away, and its name opens them again on request.
 * The body stays mounted while the plan has no reviewers yet, so the first
 * ones unfold it instead of appearing at full height.
 */
function Stage({ stage }: { stage: TimelineStage }) {
	const { row, note, time, reviewers } = stage;
	const current = isCurrent(row);
	const [chosen, setChosen] = useState<boolean | null>(null);
	const hasReviewers = !!reviewers?.length;
	const open = hasReviewers && (current || (chosen ?? false));

	return (
		<motion.li
			data-ui="live-stage"
			data-state={row.state}
			aria-current={current ? 'step' : undefined}
			initial={{ height: 0, opacity: 0 }}
			animate={{ height: 'auto', opacity: 1 }}
			exit={{ height: 0, opacity: 0 }}
			transition={UNFOLD}
			className="live-stage"
		>
			<Rail row={row} />
			<Collapsible open={open} onOpenChange={setChosen} className="live-stage-body">
				<div className="live-stage-head">
					<StageName row={row} toggles={hasReviewers && !current} open={open} />
					<StageClock time={time} />
				</div>
				<SwapLine text={note} className="live-stage-note" />
				{reviewers ? (
					<CollapsibleContent className="live-stage-reviewers">
						<ReviewerList rows={reviewers} label={`${row.label} reviewers`} />
					</CollapsibleContent>
				) : null}
			</Collapsible>
		</motion.li>
	);
}

/**
 * The pipeline as a calm timeline, top to bottom on one rail: each stage's
 * glyph morphs from not started to running to done, finished stages say how
 * long they took, and only the current stage stands open.
 */
export function StageList({ stages }: { stages: TimelineStage[] }) {
	return (
		<ol data-ui="live-stages" aria-label="Review stages" className="live-stages">
			<AnimatePresence initial={false}>
				{stages.map((stage) => (
					<Stage key={stage.row.key} stage={stage} />
				))}
			</AnimatePresence>
		</ol>
	);
}

/** Placeholder stages while the first snapshot is on its way; invisible for 200ms, then swapped in place. */
export function StageListSkeleton() {
	return (
		<div aria-hidden className="live-stages">
			{SKELETON_ROWS.map(([label, note]) => (
				<div key={label} className="live-stage live-stage-skeleton">
					<div className="live-stage-rail">
						<Skeleton className="size-4 rounded-full" />
						<span className="live-stage-line" />
					</div>
					<div className="live-stage-body">
						<Skeleton className={cn('h-[11px]', label)} />
						<Skeleton className={cn('h-[10px]', note)} />
					</div>
				</div>
			))}
		</div>
	);
}
