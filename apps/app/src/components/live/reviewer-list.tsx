'use client';

import {
	AnimatedNumber,
	Button,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	DURATION,
	EASE_OUT,
	StatusGlyph
} from '@recoder/ui';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';

import { reviewerTally, type ReviewerRow } from '@/lib/live/reviewers';

import { SwapLine } from './swap-line';

/** Rows shown before the rest fold away behind "Show all". */
const VISIBLE = 8;

/** A reviewer joining after first paint rises 4px as it fades in, and its row unfolds so nothing below jumps. */
function Reviewer({ row }: { row: ReviewerRow }) {
	return (
		<motion.li
			data-ui="live-reviewer"
			initial={{ height: 0, opacity: 0, y: 4 }}
			animate={{ height: 'auto', opacity: 1, y: 0 }}
			transition={{ duration: DURATION.toggle, ease: EASE_OUT }}
			className="overflow-hidden"
		>
			<div className="live-reviewer">
				<StatusGlyph kind={row.glyph} label={row.state} />
				<span className="live-reviewer-name" title={row.name}>
					{row.name}
				</span>
				<SwapLine text={row.step} className="live-reviewer-step" />
			</div>
		</motion.li>
	);
}

function Rows({ rows }: { rows: ReviewerRow[] }) {
	return (
		<ul className="live-reviewers">
			<AnimatePresence initial={false}>
				{rows.map((row) => (
					<Reviewer key={row.id} row={row} />
				))}
			</AnimatePresence>
		</ul>
	);
}

/** The rows past the first few, folded until asked for. */
function MoreRows({ rows }: { rows: ReviewerRow[] }) {
	const [open, setOpen] = useState(false);

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleContent>
				<Rows rows={rows} />
			</CollapsibleContent>
			<CollapsibleTrigger asChild>
				<Button variant="ghost" className="live-more">
					<ChevronDown data-open={open} className="live-more-icon" aria-hidden />
					{open ? (
						'Show fewer'
					) : (
						<span>
							Show <AnimatedNumber value={rows.length} /> more
						</span>
					)}
				</Button>
			</CollapsibleTrigger>
		</Collapsible>
	);
}

/**
 * The reviewers the plan assigned: what each covers, a glyph for its state
 * and what it is doing now. A long plan shows the first rows and folds the
 * rest. The list stays mounted while empty, so the plan's first reviewers
 * unfold in rather than pushing the page down at once.
 */
export function ReviewerList({ rows }: { rows: ReviewerRow[] }) {
	const tally = reviewerTally(rows);

	return (
		<section data-ui="live-reviewer-list" aria-labelledby="live-reviewers-title">
			<h2 id="live-reviewers-title" className="live-title">
				Reviewers
				{tally.total > 0 ? (
					<span className="live-title-count">
						<AnimatedNumber value={tally.ended} /> of <AnimatedNumber value={tally.total} /> finished
					</span>
				) : null}
			</h2>
			{rows.length === 0 ? <p className="live-empty">Reviewers start once the plan is ready.</p> : null}
			<Rows rows={rows.slice(0, VISIBLE)} />
			{rows.length > VISIBLE ? <MoreRows rows={rows.slice(VISIBLE)} /> : null}
		</section>
	);
}
