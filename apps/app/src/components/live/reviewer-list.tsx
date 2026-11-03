'use client';

import {
	AnimatedNumber,
	Button,
	cn,
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

import type { ReviewerRow } from '@/lib/live/reviewers';

import { SwapLine } from './swap-line';

/** Rows shown before the rest fold away behind "Show all". */
const VISIBLE = 8;

/** A reviewer joining after first paint unfolds its row, so nothing below jumps. */
function Reviewer({ row }: { row: ReviewerRow }) {
	return (
		<motion.li
			data-ui="live-reviewer"
			data-glyph={row.glyph}
			initial={{ height: 0, opacity: 0 }}
			animate={{ height: 'auto', opacity: 1 }}
			transition={{ duration: DURATION.toggle, ease: EASE_OUT }}
			className="live-reviewer-item"
		>
			<div className="live-reviewer">
				<StatusGlyph kind={row.glyph} label={row.state} />
				<span className="live-reviewer-name" title={row.name}>
					{row.name}
				</span>
				<SwapLine text={row.step} className={cn('live-reviewer-step', row.command && 'mono')} />
				<span className="live-reviewer-found tabular">
					{row.found > 0 ? (
						<>
							<AnimatedNumber value={row.found} /> found
						</>
					) : null}
				</span>
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
 * A stage's reviewers, one line each in a ringed list: a glyph for its state,
 * what it covers, what it is doing right now and how many possible issues it
 * raised. A long plan shows the first rows and folds the rest.
 */
export function ReviewerList({ rows, label }: { rows: ReviewerRow[]; label: string }) {
	return (
		<section data-ui="live-reviewer-list" aria-label={label} className="live-reviewer-list">
			<Rows rows={rows.slice(0, VISIBLE)} />
			{rows.length > VISIBLE ? <MoreRows rows={rows.slice(VISIBLE)} /> : null}
		</section>
	);
}
