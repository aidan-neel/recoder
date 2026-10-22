'use client';

import { AnimatedNumber, HoverList, Skeleton, StatusGlyph } from '@recoder/ui';
import { Check, LayoutList } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { decisionGlyph, plain, STATE_LABEL, TONE_LABEL, where } from '@/lib/review/labels';
import { useReview } from '@/lib/review/review-store';
import { decisionStates } from '@/lib/review/saved-decisions';
import type { Surface } from '@/lib/review/surface';

import { ChangeMap } from './change-map';
import { RailRow } from './rail-row';
import { usePhase, useSurface } from './review-view';

/** Skeleton widths for decisions that have not arrived yet. */
const PENDING_ROWS = ['w-[78%]', 'w-[62%]', 'w-[70%]'];

/** A group heading with its count on the right. */
function RailHeading({ title, children }: { title: string; children: ReactNode }) {
	return (
		<h2 className="rail-heading">
			{title}
			<span className="rail-count tabular">{children}</span>
		</h2>
	);
}

/** Needs you: one row per decision, its glyph morphing to the outcome once decided. */
function DecisionRows({ surface }: { surface: Surface }) {
	const phase = usePhase();
	const states = useReview(useShallow((state) => decisionStates(state.records)));
	const open = surface.decisions.filter((decision) => !states[decision.id]).length;

	if (surface.decisions.length === 0) {
		if (phase !== 'queued' && phase !== 'running' && phase !== 'paused') return null;

		return (
			<>
				<RailHeading title="Needs you">
					<span className={phase === 'paused' ? undefined : 'shimmer-text'}>
						{phase === 'paused' ? 'paused' : 'reviewing'}
					</span>
				</RailHeading>
				{PENDING_ROWS.map((width) => (
					<div key={width} className="rail-row-skeleton" aria-hidden>
						<Skeleton className={`h-[11px] ${width}`} />
					</div>
				))}
			</>
		);
	}

	return (
		<>
			<RailHeading title="Needs you">
				{open > 0 ? (
					<>
						<AnimatedNumber value={open} /> open
					</>
				) : (
					'all decided'
				)}
			</RailHeading>
			{surface.decisions.map((decision) => {
				const state = states[decision.id] ?? 'open';

				return (
					<RailRow key={decision.id} selection={{ kind: 'decision', id: decision.id }} decided={state !== 'open'}>
						<StatusGlyph
							kind={decisionGlyph(decision, state)}
							label={state === 'open' ? TONE_LABEL[decision.tone] : STATE_LABEL[state]}
							className="rail-glyph"
						/>
						<span className="rail-main">
							<span className="rail-title">{plain(decision.title)}</span>
							<span className="rail-meta mono">{where(decision.file, decision.line, null, true)}</span>
						</span>
					</RailRow>
				);
			})}
		</>
	);
}

/** Checked for you: what reviewers investigated and found sound. */
function ReceiptRows({ surface }: { surface: Surface }) {
	if (surface.receipts.length === 0) return null;

	return (
		<>
			<RailHeading title="Checked for you">
				<AnimatedNumber value={surface.receipts.length} />
			</RailHeading>
			{surface.receipts.map((receipt) => (
				<RailRow key={receipt.id} selection={{ kind: 'receipt', id: receipt.id }} className="rail-receipt">
					<span className="rail-check" aria-hidden>
						<Check size={12} strokeWidth={2.25} />
					</span>
					<span className="rail-main">
						<span className="rail-title">{plain(receipt.question)}</span>
					</span>
				</RailRow>
			))}
		</>
	);
}

/** Files: the change map, one swatch per file, with the lines still to read. */
function FileRows({ surface }: { surface: Surface }) {
	if (surface.files.length === 0) return null;

	return (
		<>
			<RailHeading title="Files">
				<AnimatedNumber value={surface.files.length} />
			</RailHeading>
			{surface.files.map((file) => {
				const slash = file.path.lastIndexOf('/') + 1;

				return (
					<RailRow key={file.path} selection={{ kind: 'file', path: file.path }} className="rail-file">
						<span className="rail-swatch" data-cls={file.cls} aria-hidden />
						<span className="rail-file-path mono" title={file.path}>
							<bdi>
								<span className="rail-file-dir">{file.path.slice(0, slash)}</span>
								{file.path.slice(slash)}
							</bdi>
						</span>
						<span className="rail-file-stat mono tabular">
							{file.cls === 'read' && file.readLines > 0 ? file.readLines : ''}
						</span>
					</RailRow>
				);
			})}
		</>
	);
}

/**
 * The review's index: Overview, then Needs you, Checked for you and Files.
 * Hover snaps a quiet layer to the row under the pointer; each row keeps
 * itself in view as the keyboard selects it. The rail scrolls natively
 * rather than in the kit's ScrollArea: the selection highlight travels
 * between rows by layoutId, and motion measures that travel against the
 * element marked `layoutScroll`, which has to be the scroller itself.
 */
export function ReviewRail() {
	const surface = useSurface();

	if (!surface) return null;

	return (
		<motion.nav layoutScroll aria-label="Review" data-ui="review-rail" className="rail thin-scroll">
			<HoverList itemSelector="[data-rail-row]" className="rail-list" highlightClassName="rounded-[8px]">
				<RailRow selection={{ kind: 'overview' }} className="rail-overview">
					<LayoutList size={15} className="rail-icon" aria-hidden />
					<span className="rail-main">
						<span className="rail-title">Overview</span>
						<ChangeMap attention={surface.attention} legend={false} className="rail-map" />
					</span>
				</RailRow>
				<DecisionRows surface={surface} />
				<ReceiptRows surface={surface} />
				<FileRows surface={surface} />
			</HoverList>
		</motion.nav>
	);
}
