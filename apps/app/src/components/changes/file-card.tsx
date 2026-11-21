'use client';

import type { FileDiff } from '@recoder/shared';
import { Button, Checkbox, DiffStat, FileChip, Pill } from '@recoder/ui';
import { CaretRightIcon } from '@phosphor-icons/react';
import { memo, useId, useRef, useState } from 'react';

import { openFound } from '@/lib/bugs/bug-lists';
import type { BugView } from '@/lib/bugs/types';
import type { DiffLayout } from '@/lib/changes/diff-view';
import type { ChangesFold, ChangesTarget } from '@/lib/changes/types';
import { useNear } from '@/lib/changes/use-near';
import { findingsLabel, plural } from '@/lib/shell/format';

import { FileDiffBody } from './file-diff';

/** A diff with more lines than this stays shut until asked for, so one generated file never buries the rest. */
const LARGE_LINES = 800;

/** The height of one diff line, for the placeholder a diff leaves before it mounts. */
const LINE_HEIGHT = 22;

/** The tallest placeholder: past this, the true height matters less than not jumping far. */
const PLACEHOLDER_MAX = 1600;

interface FileCardProps {
	file: FileDiff;
	layout: DiffLayout;
	viewed: boolean;
	onToggleViewed: (path: string) => void;
	/** Open bugs in this file. */
	bugs: BugView[];
	bugsHref: string;
	/** An ask to bring this file, a line of it or a finding in it into view; it opens the file. */
	target: ChangesTarget | null;
	/** The newest collapse all or expand all; the file follows it once. */
	fold: ChangesFold | null;
}

/** How many lines the file's diff shows. */
function lineCount(file: FileDiff): number {
	return file.hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
}

/** About how tall the mounted diff will be. */
function placeholderHeight(file: FileDiff): number {
	return Math.min(PLACEHOLDER_MAX, lineCount(file) * LINE_HEIGHT);
}

/**
 * One changed file: a header that names it and stays in view, and its diff
 * under it. Marking it viewed shuts it; a large diff starts shut; a jump to
 * it, or expand all, opens it. The diff mounts when the card comes near the
 * viewport, so a pull request of hundreds of files opens at once.
 */
export const FileCard = memo(function FileCard({
	file,
	layout,
	viewed,
	onToggleViewed,
	bugs,
	bugsHref,
	target,
	fold
}: FileCardProps) {
	const card = useRef<HTMLElement | null>(null);
	const near = useNear(card);
	const bodyId = useId();
	const viewedId = useId();
	const large = lineCount(file) > LARGE_LINES;
	const found = openFound(bugs);
	const [open, setOpen] = useState((!viewed && !large) || target !== null);
	const [seen, setSeen] = useState({ viewed, target, fold });

	if (viewed !== seen.viewed || target !== seen.target || fold !== seen.fold) {
		setSeen({ viewed, target, fold });

		if (viewed !== seen.viewed) setOpen(!viewed);
		if (fold !== seen.fold && fold) setOpen(fold.open);
		if (target !== seen.target && target && !target.done) setOpen(true);
	}

	return (
		<article
			ref={card}
			className="file-card"
			data-file={file.path}
			data-open={open || undefined}
			data-viewed={viewed || undefined}
			aria-label={file.path}
		>
			<header className="file-head">
				<button
					type="button"
					className="file-toggle"
					aria-expanded={open}
					aria-controls={bodyId}
					onClick={() => setOpen(!open)}
				>
					<CaretRightIcon aria-hidden className="file-caret" />
					<FileChip path={file.path} className="file-name" />
				</button>
				<div className="file-head-end">
					{bugs.length > 0 ? (
						<Pill tone={found.bugs > 0 ? 'high' : 'low'}>{findingsLabel(found.bugs, found.suggestions)}</Pill>
					) : null}
					<DiffStat additions={file.additions} deletions={file.deletions} />
					<label className="file-viewed" htmlFor={viewedId}>
						<Checkbox id={viewedId} checked={viewed} onCheckedChange={() => onToggleViewed(file.path)} />
						Viewed
					</label>
				</div>
			</header>
			{open ? (
				<div id={bodyId} className="file-body">
					{near ? (
						<FileDiffBody file={file} layout={layout} bugs={bugs} bugsHref={bugsHref} target={target} />
					) : (
						<div style={{ height: placeholderHeight(file) }} />
					)}
				</div>
			) : null}
			{!open && large && !viewed ? (
				<div id={bodyId} className="file-quiet">
					Large diff: {plural(lineCount(file), 'line')}.
					<Button variant="outline" size="sm" onClick={() => setOpen(true)}>
						Show it
					</Button>
				</div>
			) : null}
		</article>
	);
});
