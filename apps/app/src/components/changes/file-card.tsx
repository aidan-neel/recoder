'use client';

import type { FileDiff } from '@recoder/shared';
import { Button, Checkbox, Pill } from '@recoder/ui';
import { ChevronRight } from 'lucide-react';
import { memo, useId, useRef, useState } from 'react';

import type { BugView } from '@/lib/bugs/types';
import { useNear } from '@/lib/changes/use-near';
import { plural } from '@/lib/shell/format';

import { DiffStat } from '@/components/common/diff-stat';

import { FileDiffBody } from './file-diff';

/** A diff with more lines than this stays shut until asked for, so one generated file never buries the rest. */
const LARGE_LINES = 800;

/** The height of one diff line and of one hunk's range line, for the placeholder a diff leaves before it mounts. */
const LINE_HEIGHT = 22;
const HUNK_HEAD_HEIGHT = 32;

/** The tallest placeholder: past this, the true height matters less than not jumping far. */
const PLACEHOLDER_MAX = 1600;

interface FileCardProps {
	file: FileDiff;
	viewed: boolean;
	onToggleViewed: (path: string) => void;
	/** Open bugs in this file. */
	bugs: BugView[];
	bugsHref: string;
}

/** How many lines the file's diff shows. */
function lineCount(file: FileDiff): number {
	return file.hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
}

/** About how tall the mounted diff will be. */
function placeholderHeight(file: FileDiff): number {
	return Math.min(PLACEHOLDER_MAX, lineCount(file) * LINE_HEIGHT + file.hunks.length * HUNK_HEAD_HEIGHT);
}

/** The path with its folder quiet and its file name in ink. */
function FilePath({ path }: { path: string }) {
	const cut = path.lastIndexOf('/') + 1;

	return (
		<span className="file-path" title={path}>
			<bdi>
				{path.slice(0, cut)}
				<strong>{path.slice(cut)}</strong>
			</bdi>
		</span>
	);
}

/**
 * One changed file: a header that names it and stays in view, and its diff
 * under it. Marking it viewed shuts it; a large diff starts shut. The diff
 * mounts when the card comes near the viewport, so a pull request of
 * hundreds of files opens at once.
 */
export const FileCard = memo(function FileCard({ file, viewed, onToggleViewed, bugs, bugsHref }: FileCardProps) {
	const card = useRef<HTMLElement | null>(null);
	const near = useNear(card);
	const bodyId = useId();
	const viewedId = useId();
	const large = lineCount(file) > LARGE_LINES;
	const [open, setOpen] = useState(!viewed && !large);
	const [wasViewed, setWasViewed] = useState(viewed);

	if (viewed !== wasViewed) {
		setWasViewed(viewed);
		setOpen(!viewed);
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
					<ChevronRight aria-hidden />
					<FilePath path={file.path} />
				</button>
				<DiffStat additions={file.additions} deletions={file.deletions} />
				<div className="file-head-end">
					{bugs.length > 0 ? <Pill tone="high">{plural(bugs.length, 'bug')}</Pill> : null}
					<label className="file-viewed" htmlFor={viewedId}>
						<Checkbox id={viewedId} checked={viewed} onCheckedChange={() => onToggleViewed(file.path)} />
						Viewed
					</label>
				</div>
			</header>
			{open ? (
				<div id={bodyId} className="file-body">
					{near ? (
						<FileDiffBody file={file} bugs={bugs} bugsHref={bugsHref} />
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
