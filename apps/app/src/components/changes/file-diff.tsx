'use client';

import type { DiffHunk, FileDiff } from '@recoder/shared';
import { CodeLines, langForPath, type CodeLine } from '@recoder/ui';
import { memo, useMemo, useState } from 'react';

import type { BugView } from '@/lib/bugs/types';
import { useBugsView } from '@/lib/bugs/use-bugs';
import type { DiffLayout } from '@/lib/changes/diff-view';
import { hiddenBefore } from '@/lib/changes/places';
import type { ChangesTarget } from '@/lib/changes/types';
import { plural } from '@/lib/shell/format';

import { BugCard } from '@/components/bugs/bug-card';

interface FileDiffBodyProps {
	file: FileDiff;
	layout: DiffLayout;
	/** Open bugs in this file. */
	bugs: BugView[];
	bugsHref: string;
	/** An ask to bring a line or a finding of this file into view. */
	target: ChangesTarget | null;
}

/** The new-side line a bug's note sits under: the end of its range. */
function anchorLine(bug: BugView): number | null {
	return bug.endLine ?? bug.line;
}

/** True when the new-side line is inside the bug's range. */
function covers(bug: BugView, lineNo: number | null): boolean {
	if (lineNo === null || bug.line === null) return false;

	return lineNo >= bug.line && lineNo <= (bug.endLine ?? bug.line);
}

/** The hunk's lines for the kit, with the lines a bug points at flagged and the line a link names marked. */
function codeLines(hunk: DiffHunk, bugs: BugView[], marked: number | null): CodeLine[] {
	return hunk.lines.map((line) => ({
		...line,
		flagged: line.type !== 'del' && bugs.some((bug) => covers(bug, line.newNo)),
		marked: marked !== null && line.type !== 'del' && line.newNo === marked
	}));
}

/** True when some line of the file's diff carries the bug's note. */
function anchored(file: FileDiff, bug: BugView): boolean {
	const anchor = anchorLine(bug);

	return file.hunks.some((hunk) => hunk.lines.some((line) => line.type !== 'del' && line.newNo === anchor));
}

/** The ask, for the finding it names; null for any other. */
function targetOf(target: ChangesTarget | null, bug: BugView): ChangesTarget | null {
	return target?.findingId === bug.id ? target : null;
}

interface InlineBugProps {
	bug: BugView;
	bugsHref: string;
	/** An ask to bring this finding into view; it opens the finding. */
	target: ChangesTarget | null;
}

/** A finding under its line: shut to one line until pressed, and opened by a jump to it. */
function InlineBug({ bug, bugsHref, target }: InlineBugProps) {
	const view = useBugsView();
	const [open, setOpen] = useState(target !== null);
	const [seen, setSeen] = useState(target);

	if (target !== seen) {
		setSeen(target);

		if (target) setOpen(true);
	}

	return (
		<BugCard bug={bug} view={view} open={open} onToggle={() => setOpen(!open)} place="diff" reviewHref={bugsHref} />
	);
}

interface HunkProps {
	hunk: DiffHunk;
	layout: DiffLayout;
	lang: string | null;
	bugs: BugView[];
	bugsHref: string;
	/** Unchanged lines the diff leaves out above this hunk. */
	hidden: number;
	/** True for a new file, whose old side has no lines to number. */
	fresh: boolean;
	target: ChangesTarget | null;
}

/** One hunk under a row that counts the unchanged lines left out above it, with each bug's note under its line. */
function Hunk({ hunk, layout, lang, bugs, bugsHref, hidden, fresh, target }: HunkProps) {
	const marked = target?.findingId ? null : (target?.line ?? null);
	const lines = useMemo(() => codeLines(hunk, bugs, marked), [hunk, bugs, marked]);

	/** The notes of the bugs that end on this line. */
	function notes(index: number) {
		const line = hunk.lines[index];
		const here = line.type === 'del' ? [] : bugs.filter((bug) => anchorLine(bug) === line.newNo);

		if (here.length === 0) return null;

		return here.map((bug) => <InlineBug key={bug.id} bug={bug} bugsHref={bugsHref} target={targetOf(target, bug)} />);
	}

	return (
		<div className="hunk">
			{hidden > 0 ? (
				<div className="hunk-gap">
					<span>{plural(hidden, 'unchanged line')}</span>
				</div>
			) : null}
			<CodeLines
				lines={lines}
				lang={lang}
				layout={layout}
				showOldNumbers={!fresh}
				annotate={bugs.length > 0 ? notes : undefined}
			/>
		</div>
	);
}

/**
 * A file's diff: every hunk, unified or split, with the file's bugs where they happen. A new or deleted file has one
 * side only, so it stays unified. A bug whose line the diff does not show is listed above the first hunk. It
 * re-renders only when its own file, bugs or ask change.
 */
export const FileDiffBody = memo(function FileDiffBody({ file, layout, bugs, bugsHref, target }: FileDiffBodyProps) {
	const lang = langForPath(file.path);
	const loose = bugs.filter((bug) => !anchored(file, bug));
	const hidden = hiddenBefore(file);
	const fresh = file.hunks.every((hunk) => hunk.lines.every((line) => line.type === 'add'));
	const removed = file.hunks.every((hunk) => hunk.lines.every((line) => line.type === 'del'));

	if (file.hunks.length === 0) {
		return <div className="file-quiet">No lines to show. The file was renamed, or it is binary.</div>;
	}

	return (
		<>
			{loose.length > 0 ? (
				<div className="file-bugs">
					{loose.map((bug) => (
						<InlineBug key={bug.id} bug={bug} bugsHref={bugsHref} target={targetOf(target, bug)} />
					))}
				</div>
			) : null}
			{file.hunks.map((hunk, index) => (
				<Hunk
					key={hunk.header + hunk.newStart}
					hunk={hunk}
					layout={fresh || removed ? 'unified' : layout}
					lang={lang}
					bugs={bugs}
					bugsHref={bugsHref}
					hidden={hidden[index]}
					fresh={fresh}
					target={target}
				/>
			))}
		</>
	);
});
