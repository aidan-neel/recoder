'use client';

import type { DiffLine } from '@recoder/shared';
import { Button, Pill, Skeleton } from '@recoder/ui';
import { useMemo, useState, useTransition } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { stateOf } from '@/lib/review/decisions';
import { fileHunks, foldHunks, type ExcerptLine } from '@/lib/review/excerpt';
import { isNewFile } from '@/lib/review/files';
import { CLASS_LABEL } from '@/lib/review/labels';
import { isRunning, surfaceOf, useReview, type ReviewStore } from '@/lib/review/review-store';
import type { Decision } from '@/lib/review/surface';

import { HunkCode } from './code-frame';
import { KickerText } from './detail-parts';
import { FileNote } from './file-note';

/** A diff longer than this folds, so a lockfile or a generated file never renders in full on the way through. */
const FOLD_OVER = 600;

/** Lines a folded diff shows from its top. */
const FOLD_SHOWN = 400;

/** Lines a folded diff keeps either side of a decision. */
const FOLD_RADIUS = 8;

/** Past this many lines, the whole diff draws without highlighting, which would hold the page for too long. */
const HIGHLIGHT_MAX = 3000;

/** A diff line's place on its own side: `new:15`, or `old:20` for a deleted line. */
function lineKey(line: DiffLine): string {
	return line.type === 'del' ? `old:${line.oldNo}` : `new:${line.newNo}`;
}

/** The line a decision ends on, keyed like `lineKey` on the side it was raised against; null when it names none. */
function endKey(decision: Decision): string | null {
	const end = decision.endLine ?? decision.line;

	return end === null ? null : `${decision.side}:${end}`;
}

/** The decisions raised on one file. */
function inFile(state: ReviewStore, path: string): Decision[] {
	return surfaceOf(state)?.decisions.filter((decision) => decision.file === path) ?? [];
}

/**
 * The open decisions' ranges in one file as flat `[line, endLine, …]` pairs.
 * Numbers compare by value, so the selection holds still (and the code keeps
 * its highlighting) until a decision in this file opens or closes.
 */
function openRanges(state: ReviewStore, path: string): number[] {
	return inFile(state, path).flatMap((decision) =>
		decision.line !== null && stateOf(state.records, decision.id) === 'open'
			? [decision.line, decision.endLine ?? decision.line]
			: []
	);
}

/** Flat `[line, endLine, …]` pairs back as ranges. */
function asRanges(flat: number[]): { line: number; endLine: number }[] {
	return Array.from({ length: flat.length / 2 }, (_, index) => ({
		line: flat[index * 2],
		endLine: flat[index * 2 + 1]
	}));
}

/** Decisions stacked under a line, or under the header when they name no line the view shows. */
function Notes({ decisions }: { decisions: Decision[] }) {
	const records = useReview((state) => state.records);

	return (
		<div className="flex flex-col gap-1.5">
			{decisions.map((decision) => (
				<FileNote key={decision.id} decision={decision} state={stateOf(records, decision.id)} />
			))}
		</div>
	);
}

/**
 * The diff a file view draws: every hunk, or for a long diff its top and the
 * lines around each decision, until the person asks for the rest.
 */
function useShownHunks(path: string, decisions: Decision[]) {
	const diff = useReview((state) => state.files.find((item) => item.path === path) ?? null);
	const ranges = useReview(useShallow((state) => openRanges(state, path)));
	const ends = useReview(useShallow((state) => inFile(state, path).map(endKey)));
	const [whole, setWhole] = useState(false);
	const [expanding, startExpanding] = useTransition();
	const hunks = useMemo(() => (diff ? fileHunks(diff, asRanges(ranges)) : []), [diff, ranges]);
	const total = useMemo(() => hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0), [hunks]);
	const folds = !whole && total > FOLD_OVER;

	const shown = useMemo(() => {
		if (!folds) return { runs: hunks, after: 0 };

		const anchors = new Set(ends);

		return foldHunks(hunks, (line) => line.flagged || anchors.has(lineKey(line)), FOLD_SHOWN, FOLD_RADIUS);
	}, [folds, hunks, ends]);

	const unplaced = useMemo(() => {
		const keys = new Set(shown.runs.flatMap((run) => run.lines.map(lineKey)));

		return decisions.filter((decision) => !keys.has(endKey(decision) ?? ''));
	}, [shown, decisions]);

	return {
		diff,
		total,
		folds,
		expanding,
		shown,
		unplaced,
		expand: () => startExpanding(() => setWhole(true))
	};
}

/** A changed file in full, with open decisions marked. A long diff folds until the person asks for every line. */
export function FileView({ path }: { path: string }) {
	const waiting = useReview((state) => state.files.length === 0 && isRunning(state.review));
	const file = useReview((state) => surfaceOf(state)?.files.find((item) => item.path === path) ?? null);
	const decisions = useReview(useShallow((state) => inFile(state, path)));
	const { diff, total, folds, expanding, shown, unplaced, expand } = useShownHunks(path, decisions);

	if (waiting) {
		return (
			<article aria-busy="true" className="file-detail">
				<Skeleton className="mb-3.5 h-5 w-40 rounded-[6px]" />
				<Skeleton className="h-[480px] rounded-[10px]" />
			</article>
		);
	}

	if (!file || !diff) return null;

	return (
		<article aria-label={path} className="file-detail">
			<header className="mb-3.5 flex flex-wrap items-center gap-2.5">
				<Pill tone="question" icon={<span className="att-dot" data-cls={file.cls} aria-hidden="true" />}>
					{CLASS_LABEL[file.cls]}
				</Pill>
				{file.examined ? null : <KickerText>No reviewer opened this file</KickerText>}
			</header>

			{unplaced.length > 0 ? (
				<div className="mb-3.5">
					<Notes decisions={unplaced} />
				</div>
			) : null}

			<HunkCode
				path={path}
				fresh={isNewFile(diff)}
				hunks={shown.runs}
				after={shown.after}
				plain={!folds && total > HIGHLIGHT_MAX}
				aside={
					<span className="shrink-0 pr-1.5 font-mono text-[11.5px] tabular-nums">
						<span className="text-ok">+{file.additions}</span> <span className="text-sev-high">−{file.deletions}</span>
					</span>
				}
				annotate={(line: ExcerptLine) => {
					const key = lineKey(line);
					const ending = decisions.filter((item) => endKey(item) === key);

					return ending.length > 0 ? <Notes decisions={ending} /> : null;
				}}
			/>

			{folds ? (
				<Button variant="outline" status={expanding ? 'pending' : 'idle'} className="mt-3" onClick={expand}>
					Show all {total.toLocaleString('en-US')} lines
				</Button>
			) : null}
		</article>
	);
}
