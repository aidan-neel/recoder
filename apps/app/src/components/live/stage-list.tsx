'use client';

import { cn, DURATION, EASE_OUT, Skeleton, StatusGlyph } from '@recoder/ui';
import { AnimatePresence, motion, type Transition } from 'motion/react';

import type { StageRow, StageState } from '@/lib/live/stages';

import { SwapLine } from './swap-line';

/** A row joining or leaving the list, or the running stage's detail line moving to the next stage, unfolds its height. */
const UNFOLD: Transition = { duration: DURATION.toggle, ease: EASE_OUT };

const STATE_LABEL: Record<StageState, string> = {
	idle: 'Not started',
	active: 'Running',
	paused: 'Paused',
	done: 'Done'
};

/** Widths of the placeholder rows, so they read as labels of different lengths. */
const SKELETON_WIDTHS = ['w-[34%]', 'w-[52%]', 'w-[44%]', 'w-[30%]', 'w-[48%]', 'w-[40%]'];

/** The running stage's latest activity, unfolding under its label. */
function StageDetail({ text }: { text: string }) {
	return (
		<motion.div
			data-ui="live-stage-detail"
			initial={{ height: 0, opacity: 0 }}
			animate={{ height: 'auto', opacity: 1 }}
			exit={{ height: 0, opacity: 0 }}
			transition={UNFOLD}
			className="overflow-hidden"
		>
			<SwapLine text={text} className="live-stage-detail" />
		</motion.div>
	);
}

function Stage({ row, detail }: { row: StageRow; detail: string | null }) {
	const running = row.state === 'active' || row.state === 'paused';

	return (
		<motion.li
			data-ui="live-stage"
			data-state={row.state}
			aria-current={running ? 'step' : undefined}
			initial={{ height: 0, opacity: 0 }}
			animate={{ height: 'auto', opacity: 1 }}
			exit={{ height: 0, opacity: 0 }}
			transition={UNFOLD}
			className="live-stage"
		>
			<div className="live-stage-row">
				<StatusGlyph kind={row.glyph} label={STATE_LABEL[row.state]} />
				<div className="min-w-0 flex-1">
					<span className="live-stage-label">{row.label}</span>
					<AnimatePresence initial={false}>
						{running ? <StageDetail key="detail" text={detail || 'Starting'} /> : null}
					</AnimatePresence>
				</div>
			</div>
		</motion.li>
	);
}

/**
 * The pipeline's stages, top to bottom, each with a glyph that morphs from
 * idle to running to done. Only the running stage has a second line.
 */
export function StageList({ rows, detail }: { rows: StageRow[]; detail: string | null }) {
	return (
		<ol data-ui="live-stages" aria-label="Review stages" className="live-stages">
			<AnimatePresence initial={false}>
				{rows.map((row) => (
					<Stage key={row.key} row={row} detail={detail} />
				))}
			</AnimatePresence>
		</ol>
	);
}

/** Placeholder rows while the first snapshot is on its way; invisible for 200ms, then swapped in place. */
export function StageListSkeleton() {
	return (
		<div aria-hidden className="live-stages">
			{SKELETON_WIDTHS.map((width) => (
				<div key={width} className="live-stage-row live-stage-skeleton">
					<Skeleton className="size-4 rounded-full" />
					<Skeleton className={cn('h-[11px]', width)} />
				</div>
			))}
		</div>
	);
}
