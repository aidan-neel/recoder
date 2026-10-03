import type { ReviewCodeContext } from '@recoder/shared';
import type { DiffLine } from '$lib/diff/diff';
import type { FlatLine } from '$lib/diff/diff-rows';

/** A note being written or edited against a range of diff lines. */
export interface PendingNote {
	mode: 'create' | 'edit';
	id?: string;
	file: string;
	startLine: number;
	endLine: number;
	side: 'old' | 'new';
	quote: string;
	newText?: string;
	oldText?: string;
	diffContext?: string;
	hunkHeader?: string;
}

/** Longest quote kept from the selected lines. */
const QUOTE_MAX = 2000;

function marker(line: DiffLine): string {
	return line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
}

function cap(text: string, max = 4000): string {
	const suffix = '\n…[truncated]';

	return text.length > max ? text.slice(0, max - suffix.length) + suffix : text;
}

/** Whole lines on one side, not the raw selection (which carries gutter numbers and partial lines). */
function sideText(slice: FlatLine[], side: 'old' | 'new'): string {
	return slice
		.filter(({ line }) => (side === 'new' ? line.newNo : line.oldNo) !== null)
		.map(({ line }) => line.text)
		.join('\n');
}

/** The rows from `from` to `to` plus three either side, as unified diff text. */
function diffContextAround(flatLines: FlatLine[], from: number, to: number): string {
	return cap(
		flatLines
			.slice(Math.max(0, from - 3), Math.min(flatLines.length, to + 4))
			.map(({ line }) => `${marker(line)}${line.text}`)
			.join('\n')
	);
}

/** A draft for the rows `from`..`to`, on the new side when it has any lines there. */
export function rangeDraft(flatLines: FlatLine[], from: number, to: number, file: string): PendingNote | null {
	const slice = flatLines.slice(from, to + 1);
	const newNos = slice.map(({ line }) => line.newNo).filter((n): n is number => n !== null);
	const oldNos = slice.map(({ line }) => line.oldNo).filter((n): n is number => n !== null);
	const side: 'old' | 'new' = newNos.length > 0 ? 'new' : 'old';
	const lines = side === 'new' ? newNos : oldNos;

	if (lines.length === 0) return null;

	return {
		mode: 'create',
		file,
		startLine: Math.min(...lines),
		endLine: Math.max(...lines),
		side,
		quote: sideText(slice, side).slice(0, QUOTE_MAX),
		newText: cap(sideText(slice, 'new')),
		oldText: cap(sideText(slice, 'old')),
		diffContext: diffContextAround(flatLines, from, to),
		hunkHeader: slice[slice.length - 1]?.hunk.header
	};
}

/** A draft for one line, from its line-number control. */
export function lineDraft(flatLines: FlatLine[], line: DiffLine, file: string): PendingNote | null {
	const index = flatLines.findIndex((item) => item.line === line);
	const number = line.newNo ?? line.oldNo;

	if (number === null) return null;

	return {
		mode: 'create',
		file,
		startLine: number,
		endLine: number,
		side: line.newNo === null ? 'old' : 'new',
		quote: line.text.slice(0, QUOTE_MAX),
		diffContext: diffContextAround(flatLines, index, index)
	};
}

/** The part of a draft the chat composer quotes. */
export function askContext(draft: PendingNote): ReviewCodeContext {
	const { file, startLine, endLine, side, quote, diffContext } = draft;

	return { file, startLine, endLine, side, quote, diffContext };
}

/** True when the line falls inside the range on its side. */
export function inRange(line: DiffLine, range: Pick<ReviewCodeContext, 'side' | 'startLine' | 'endLine'>): boolean {
	const n = range.side === 'new' ? line.newNo : line.oldNo;

	return n !== null && n >= range.startLine && n <= range.endLine;
}
