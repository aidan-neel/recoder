'use client';

import type { DiffHunk, FileDiff } from '@recoder/shared';
import { Button, CodeLines, FileChip, Icon, langForPath, type CodeLine } from '@recoder/ui';
import { memo, useMemo, useState } from 'react';

import type { BugView } from '@/lib/bugs/types';
import { useBugsView } from '@/lib/bugs/use-bugs';
import type { DiffLayout } from '@/lib/changes/diff-view';
import { isMovedLine, spansIn, type MoveSpan } from '@/lib/changes/moves';
import { hiddenBefore } from '@/lib/changes/places';
import type { ChangesTarget } from '@/lib/changes/types';
import { useChangesNav } from '@/lib/changes/use-changes';
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
	/** Blocks the change moved into or out of this file. */
	spans: readonly MoveSpan[];
	/** True for a guide hunk's card, which names its lines in its header, so no row counts the lines above it. */
	part?: boolean;
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

/** True when the line is the one a link names, on the side it names. */
function isMarked(line: DiffHunk['lines'][number], target: ChangesTarget | null): boolean {
	if (!target || target.findingId || target.line === null) return false;
	if (target.side === 'old') return line.type === 'del' && line.oldNo === target.line;

	return line.type !== 'del' && line.newNo === target.line;
}

/**
 * The hunk's lines for the kit: the lines a bug or warning points at flagged (an FYI note flags none), the line a
 * link names marked, and code moved without a change drawn as old code.
 */
function codeLines(
	hunk: DiffHunk,
	bugs: BugView[],
	target: ChangesTarget | null,
	spans: readonly MoveSpan[]
): CodeLine[] {
	return hunk.lines.map((line) => ({
		...line,
		flagged: line.type !== 'del' && bugs.some((bug) => bug.tier !== 'fyi' && covers(bug, line.newNo)),
		marked: isMarked(line, target),
		moved: isMovedLine(line, spans)
	}));
}

/** A moved or copied block's place on its other side, and a way there when the diff shows that file. */
export function MoveNote({ span }: { span: MoveSpan }) {
	const nav = useChangesNav();
	const verb = span.direction === 'to' ? 'Moved to' : span.kind === 'copied' ? 'Copied from' : 'Moved from';

	return (
		<div className="move-note" data-exact={span.exact || undefined}>
			<Icon name="subdirectory_arrow_right" className="move-note-icon" />
			<span>{verb}</span>
			<FileChip path={span.other.path} line={span.other.line} framed />
			<span className="meta">{span.exact ? 'unchanged' : 'with a small change'}</span>
			{span.other.inDiff ? (
				<Button
					variant="ghost"
					size="sm"
					className="move-note-go"
					onClick={() => nav.goTo(span.other.path, span.other.line, null, span.direction === 'from' ? 'old' : 'new')}
				>
					{span.direction === 'from' ? 'Go to original' : 'Go to new place'}
				</Button>
			) : null}
		</div>
	);
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
	spans: readonly MoveSpan[];
}

/**
 * One hunk under a row that counts the unchanged lines left out above it, then a line for each block in it that the
 * change moved or copied, with each bug's note under its line.
 */
function Hunk({ hunk, layout, lang, bugs, bugsHref, hidden, fresh, target, spans }: HunkProps) {
	const here = useMemo(() => spansIn(hunk, spans), [hunk, spans]);
	const lines = useMemo(() => codeLines(hunk, bugs, target, here), [hunk, bugs, target, here]);

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
			{here.map((span) => (
				<MoveNote key={`${span.direction}:${span.start}`} span={span} />
			))}
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
export const FileDiffBody = memo(function FileDiffBody({
	file,
	layout,
	bugs,
	bugsHref,
	target,
	spans,
	part = false
}: FileDiffBodyProps) {
	const lang = langForPath(file.path);
	const loose = bugs.filter((bug) => !anchored(file, bug));
	const hidden = hiddenBefore(file);
	const fresh = file.hunks.every((hunk) => hunk.lines.every((line) => line.type === 'add'));
	const removed = file.hunks.every((hunk) => hunk.lines.every((line) => line.type === 'del'));

	if (file.hunks.length === 0) {
		return (
			<div className="file-quiet">
				{file.status === 'renamed' || file.status === 'copied'
					? `No lines changed. The file was ${file.status} as it was.`
					: 'No lines to show. The file is binary or empty.'}
			</div>
		);
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
					hidden={part ? 0 : hidden[index]}
					fresh={fresh}
					target={target}
					spans={spans}
				/>
			))}
		</>
	);
});
