import type { FileDiff, FindingLocation } from '@recoder/shared';
import { lineLabel, outsideDiffNote } from '$lib/diff/outside-diff';

/** A related location as its link shows it. */
export interface RelatedLink {
	file: string;
	line: number | null;
	side: 'old' | 'new';
	/** `limiter.ts:12–14`; the file name alone for a whole-file location. */
	label: string;
	/** Why the diff can't scroll there, or null when it can. */
	reason: string | null;
}

/** Whether the file's diff (expanded to the whole file when the checkout exists) has a row for the line. */
function hasRow(file: FileDiff, line: number, side: 'old' | 'new'): boolean {
	return file.hunks.some((hunk) => hunk.lines.some((row) => (side === 'old' ? row.oldNo : row.newNo) === line));
}

function reasonFor(location: FindingLocation, files: FileDiff[] | null, side: 'old' | 'new'): string | null {
	if (!files) return "The diff isn't loaded yet.";

	const file = files.find((item) => item.path === location.file);

	if (!file) return "This file isn't part of the pull request.";
	if (location.line === undefined || hasRow(file, location.line, side)) return null;

	return outsideDiffNote(location.line, location.endLine);
}

/** A finding's related locations, each with whether the diff can scroll to it and why not. */
export function relatedLinks(locations: FindingLocation[] | undefined, files: FileDiff[] | null): RelatedLink[] {
	return (locations ?? []).map((location) => {
		const side = location.side ?? 'new';
		const name = location.file.slice(location.file.lastIndexOf('/') + 1);

		return {
			file: location.file,
			line: location.line ?? null,
			side,
			label: location.line === undefined ? name : `${name}:${lineLabel(location.line, location.endLine)}`,
			reason: reasonFor(location, files, side)
		};
	});
}
