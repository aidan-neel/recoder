'use client';

import type { DiffHunk, FileDiff } from '@recoder/shared';
import { CodeLines, langForPath, type CodeLine } from '@recoder/ui';
import { memo, useMemo } from 'react';

import type { BugView } from '@/lib/bugs/types';

import { LineBug } from './line-bug';

interface FileDiffBodyProps {
	file: FileDiff;
	/** Open bugs in this file. */
	bugs: BugView[];
	bugsHref: string;
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

/** The hunk's lines for the kit, with the lines a bug points at flagged. */
function codeLines(hunk: DiffHunk, bugs: BugView[]): CodeLine[] {
	return hunk.lines.map((line) => ({
		...line,
		flagged: line.type !== 'del' && bugs.some((bug) => covers(bug, line.newNo))
	}));
}

/** True when some line of the file's diff carries the bug's note. */
function anchored(file: FileDiff, bug: BugView): boolean {
	const anchor = anchorLine(bug);

	return file.hunks.some((hunk) => hunk.lines.some((line) => line.type !== 'del' && line.newNo === anchor));
}

interface HunkProps {
	hunk: DiffHunk;
	lang: string | null;
	bugs: BugView[];
	bugsHref: string;
}

/** One hunk: its range line, then its lines with each bug's note under the line the bug ends on. */
function Hunk({ hunk, lang, bugs, bugsHref }: HunkProps) {
	const lines = useMemo(() => codeLines(hunk, bugs), [hunk, bugs]);

	/** The notes of the bugs that end on this line. */
	function notes(index: number) {
		const line = hunk.lines[index];
		const here = line.type === 'del' ? [] : bugs.filter((bug) => anchorLine(bug) === line.newNo);

		if (here.length === 0) return null;

		return here.map((bug) => <LineBug key={bug.id} bug={bug} href={bugsHref} />);
	}

	return (
		<div className="hunk">
			<div className="hunk-head">{hunk.header}</div>
			<CodeLines lines={lines} lang={lang} annotate={bugs.length > 0 ? notes : undefined} />
		</div>
	);
}

/**
 * A file's diff: every hunk, with the file's bugs where they happen. A bug
 * whose line the diff does not show is listed above the first hunk. It
 * re-renders only when its own file or bugs change.
 */
export const FileDiffBody = memo(function FileDiffBody({ file, bugs, bugsHref }: FileDiffBodyProps) {
	const lang = langForPath(file.path);
	const loose = bugs.filter((bug) => !anchored(file, bug));

	if (file.hunks.length === 0) {
		return <div className="file-quiet">No lines to show. The file was renamed, or it is binary.</div>;
	}

	return (
		<>
			{loose.length > 0 ? (
				<div className="file-bugs">
					{loose.map((bug) => (
						<LineBug key={bug.id} bug={bug} href={bugsHref} />
					))}
				</div>
			) : null}
			{file.hunks.map((hunk) => (
				<Hunk key={hunk.header + hunk.newStart} hunk={hunk} lang={lang} bugs={bugs} bugsHref={bugsHref} />
			))}
		</>
	);
});
