'use client';

import {
	AnimatedNumber,
	Button,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	HoverList,
	StatusGlyph
} from '@recoder/ui';
import { SkeletonRows } from '@recoder/ui/skeleton';
import { StatusNotice } from '@recoder/ui/status-notice';
import { Check, ChevronDown, LayoutList } from 'lucide-react';
import { memo, useDeferredValue, useId, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { decisionGlyph, plain, STATE_LABEL, TONE_LABEL, where } from '@/lib/review/labels';
import { useReview } from '@/lib/review/review-store';
import { decisionStates } from '@/lib/review/saved-decisions';
import {
	quietedTopicOf,
	type Decision,
	type DecisionState,
	type QuietedTopic,
	type Receipt,
	type Surface
} from '@/lib/review/surface';

import { ChangeMap } from './change-map';
import { RailRow } from './rail-row';
import { ReadFailed } from './read-failed';
import { DECISION_ROW } from './review-skeleton';
import { useNoFiles, usePhase, useSurface } from './review-view';
import { TurnBackOn } from './turn-back-on';

/** Placeholder rows for decisions that have not arrived yet, at a decision row's height. */
const PENDING_ROWS = 3;

/**
 * A file row's height at the root's 16px (`.rail-file`): a 17.25px line of
 * 11.5px mono with 5px of padding each side. It grows with the root font, as
 * every CSS px does.
 */
const FILE_ROW = 27.25;

/** The 1px gap between rail rows, which stays 1px at every root font size. */
const ROW_GAP = 1;

/** A group heading with its count on the right. */
function RailHeading({ title, children }: { title: string; children: ReactNode }) {
	return (
		<h2 className="rail-heading">
			{title}
			<span className="rail-count tabular">{children}</span>
		</h2>
	);
}

/**
 * One decision's row, its glyph morphing to the outcome once decided. Items
 * keep their identity while the review does, so deciding re-renders only the
 * row whose state changed.
 */
const DecisionRow = memo(function DecisionRow({ decision, state }: { decision: Decision; state: DecisionState }) {
	return (
		<RailRow selection={{ kind: 'decision', id: decision.id }} decided={state !== 'open'}>
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
});

/**
 * Needs you: one row per decision. While reviewers work and nothing is in
 * yet, placeholder rows hold the place; a finished review that found
 * nothing says so in the heading.
 */
function DecisionRows({ surface }: { surface: Surface }) {
	const phase = usePhase();
	const states = useReview(useShallow((state) => decisionStates(state.records)));
	const open = surface.decisions.filter((decision) => !states[decision.id]).length;

	if (surface.decisions.length === 0) {
		const waiting = phase === 'queued' || phase === 'running' || phase === 'paused';

		if (!waiting) return <RailHeading title="Needs you">none</RailHeading>;

		return (
			<>
				<RailHeading title="Needs you">
					<span className={phase === 'paused' ? undefined : 'shimmer-text'}>
						{phase === 'paused' ? 'paused' : 'reviewing'}
					</span>
				</RailHeading>
				<SkeletonRows count={PENDING_ROWS} height={DECISION_ROW} glyph rowClassName="rail-skeleton-row" />
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
			{surface.decisions.map((decision) => (
				<DecisionRow key={decision.id} decision={decision} state={states[decision.id] ?? 'open'} />
			))}
		</>
	);
}

/** One quieted topic: its label, how many findings it holds and Turn back on, then its findings, which open to read. */
function QuietedTopicRows({ topic }: { topic: QuietedTopic }) {
	const labelId = useId();

	return (
		<>
			<div className="rail-topic">
				<span id={labelId} className="rail-topic-label" title={plain(topic.label)}>
					{plain(topic.label)}
				</span>
				<span className="rail-count tabular">{topic.decisions.length}</span>
				<TurnBackOn topicId={topic.id} describedBy={labelId} />
			</div>
			{topic.decisions.map((decision) => (
				<DecisionRow key={decision.id} decision={decision} state="open" />
			))}
		</>
	);
}

/**
 * Quieted: findings of topics people in the repository keep marking not an
 * issue, closed by default and counted in nothing else. It opens by itself
 * for a quieted finding a link selected, and closing it while one is open
 * goes back to the overview, since the finding's row would be out of sight.
 * A review without any leaves the group out.
 */
function QuietedRows({ surface }: { surface: Surface }) {
	const selectedHere = useReview(
		(state) => state.selection.kind === 'decision' && quietedTopicOf(surface, state.selection.id) !== null
	);

	const [open, setOpen] = useState(selectedHere);

	if (selectedHere && !open) setOpen(true);

	if (surface.quieted.length === 0) return null;

	const count = surface.quieted.reduce((sum, topic) => sum + topic.decisions.length, 0);

	function onOpenChange(next: boolean): void {
		setOpen(next);

		if (!next && selectedHere) useReview.getState().select({ kind: 'overview' });
	}

	return (
		<Collapsible open={open} onOpenChange={onOpenChange}>
			<h2 className="rail-heading">
				<CollapsibleTrigger asChild>
					<Button variant="ghost" className="rail-quiet-trigger">
						Quieted
						<ChevronDown data-open={open} className="rail-quiet-icon" aria-hidden />
					</Button>
				</CollapsibleTrigger>
				<span className="rail-count tabular">
					<AnimatedNumber value={count} />
				</span>
			</h2>
			<CollapsibleContent className="rail-quiet-body">
				<p className="rail-quiet-reason">Often marked not an issue in this repository.</p>
				{surface.quieted.map((topic) => (
					<QuietedTopicRows key={topic.id} topic={topic} />
				))}
			</CollapsibleContent>
		</Collapsible>
	);
}

/** One receipt's row; it never changes while the review does. */
const ReceiptRow = memo(function ReceiptRow({ receipt }: { receipt: Receipt }) {
	return (
		<RailRow selection={{ kind: 'receipt', id: receipt.id }} className="rail-receipt">
			<span className="rail-check" aria-hidden>
				<Check size={12} strokeWidth={2.25} />
			</span>
			<span className="rail-main">
				<span className="rail-title">{plain(receipt.question)}</span>
			</span>
		</RailRow>
	);
});

/** Checked for you: what reviewers investigated and found sound. A review without any leaves the group out. */
function ReceiptRows({ surface }: { surface: Surface }) {
	if (surface.receipts.length === 0) return null;

	return (
		<>
			<RailHeading title="Checked for you">
				<AnimatedNumber value={surface.receipts.length} />
			</RailHeading>
			{surface.receipts.map((receipt) => (
				<ReceiptRow key={receipt.id} receipt={receipt} />
			))}
		</>
	);
}

type SurfaceFile = Surface['files'][number];

/** True when a file row would draw the same: deciding rebuilds every file, but only a changed class or count shows. */
function sameFileRow(a: { file: SurfaceFile }, b: { file: SurfaceFile }): boolean {
	return a.file.path === b.file.path && a.file.cls === b.file.cls && a.file.readLines === b.file.readLines;
}

/** One changed file: its swatch, its path (the directory dimmed) and the lines still to read. */
const FileRow = memo(function FileRow({ file }: { file: SurfaceFile }) {
	const slash = file.path.lastIndexOf('/') + 1;

	return (
		<RailRow selection={{ kind: 'file', path: file.path }} className="rail-file">
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
}, sameFileRow);

/**
 * File rows the window can show under the rail's `above` rows. Every row
 * counts as short as a file row, the shortest in the rail, and headings
 * count as nothing, so it errs on drawing more.
 */
function firstScreen(above: number): number {
	if (typeof window === 'undefined') return Infinity;

	return Math.max(Math.ceil(window.innerHeight / FILE_ROW) - above, 0);
}

/**
 * How many files to draw: those the window can show at once, then the rest
 * in a background render once the page has painted, so a diff of hundreds of
 * files no longer weighs on the review's first paint. The selected file is
 * always drawn, so a link to it, or a key that reaches it before the rest
 * are in, shows its row and keeps it in view.
 */
function useDrawnFiles(files: SurfaceFile[], above: number): number {
	const later = useDeferredValue(files.length, 0);
	const all = later >= files.length;
	const selected = useReview((state) => (!all && state.selection.kind === 'file' ? state.selection.path : null));
	const at = selected === null ? -1 : files.findIndex((file) => file.path === selected);

	return Math.min(files.length, Math.max(later, firstScreen(above), at + 1));
}

/**
 * Holds the height of the file rows not drawn yet, so the rail's scroll
 * height is final from the first paint and the scrollbar never jumps.
 */
function FilesToCome({ count }: { count: number }) {
	if (count === 0) return null;

	return (
		<div
			aria-hidden
			className="shrink-0"
			style={{ height: `calc(${(count * FILE_ROW) / 16}rem + ${(count - 1) * ROW_GAP}px)` }}
		/>
	);
}

/** The line a passed review whose diff came back empty shows in the rail's Files group. */
function NoFiles({ className }: { className: string }) {
	return <StatusNotice variant="inline" title="No changed files to show." className={className} />;
}

/**
 * Files: the change map, one swatch per file, with the lines still to read.
 * Rows past the first screen draw after the first paint, their space held.
 * A diff that failed to load says so with Try again, here only, even while
 * the review runs, and a passed review whose diff came back empty says so;
 * any other review without files leaves the group out.
 */
function FileRows({ surface }: { surface: Surface }) {
	const failed = useReview((state) => state.filesError !== null);
	const noFiles = useNoFiles();
	const drawn = useDrawnFiles(surface.files, 1 + surface.decisions.length + surface.receipts.length);

	if (surface.files.length === 0) {
		if (!failed && !noFiles) return null;

		return (
			<>
				<RailHeading title="Files">{null}</RailHeading>
				{failed ? <ReadFailed part="files" className="rail-empty" /> : <NoFiles className="rail-empty" />}
			</>
		);
	}

	return (
		<>
			<RailHeading title="Files">
				<AnimatedNumber value={surface.files.length} />
			</RailHeading>
			{surface.files.slice(0, drawn).map((file) => (
				<FileRow key={file.path} file={file} />
			))}
			<FilesToCome count={surface.files.length - drawn} />
		</>
	);
}

/** The selected row, which the rail's selection layer follows. */
const SELECTED_ROW = "[data-rail-row][data-selected='true']";

/**
 * The review's index: Overview, then Needs you, Quieted, Checked for you
 * and Files.
 * Hover snaps a quiet layer to the row under the pointer, and the selection
 * layer follows the selected row: it slides to a row clicked and snaps, in
 * the same frame, to one j, k or an arrow chose, so a held key never leaves
 * it sliding behind. A move reads the selected row's box once, in the next
 * animation frame, in the same layout the paint then uses; a change to the
 * rows themselves (a count or a glyph as a decision lands) reads it again.
 * Each row keeps itself in view as the keyboard selects it, by setting the
 * rail's own scroll.
 */
export function ReviewRail() {
	const surface = useSurface();

	if (!surface) return null;

	return (
		<nav aria-label="Review" data-ui="review-rail" className="rail thin-scroll">
			<HoverList
				itemSelector="[data-rail-row]"
				selectedSelector={SELECTED_ROW}
				className="rail-list"
				highlightClassName="rounded-[8px]"
			>
				<RailRow selection={{ kind: 'overview' }} className="rail-overview">
					<LayoutList size={15} className="rail-icon" aria-hidden />
					<span className="rail-main">
						<span className="rail-title">Overview</span>
						<ChangeMap attention={surface.attention} legend={false} className="rail-map" />
					</span>
				</RailRow>
				<DecisionRows surface={surface} />
				<QuietedRows surface={surface} />
				<ReceiptRows surface={surface} />
				<FileRows surface={surface} />
			</HoverList>
		</nav>
	);
}
