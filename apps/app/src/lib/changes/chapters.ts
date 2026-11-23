import type { DiffGuide, DiffHunk, FileDiff } from '@recoder/shared';

import { fileChange } from './file-tree';

/** The id of the chapter that gathers what the guide leaves out, so no hunk is lost. */
const REST_ID = 'rest';

/** A hunk the guide places, or a file renamed with no line changed, which has one entry and no hunk. */
export interface ChapterHunk {
	id: string;
	path: string;
	/** The hunk's index in its file's diff; null for a file renamed as it was. */
	index: number | null;
	/** The first line it shows: on the new side, or on the old side when it only removes; null with no hunk. */
	line: number | null;
	/** One sentence on what the hunk does; only a refined guide has them. */
	explanation: string | null;
	/** True when the hunk only moves code, so it reads as a note and not as new code. A renamed file is never one. */
	moved: boolean;
	/** This hunk among its file's hunks in reading order, from 1, and the other chapters that hold the rest. */
	place: { at: number; of: number; elsewhere: number[] };
}

/** One chapter of the guide: hunks that belong together, in the order to read them. */
export interface Chapter {
	id: string;
	/** Its place in the reading order, from 1. */
	number: number;
	title: string;
	explanation: string | null;
	hunks: ChapterHunk[];
}

type Draft = Omit<ChapterHunk, 'place'>;

/** A hunk's id as the review names it: the file, then the old and new ranges of its header. */
export function hunkId(path: string, hunk: Pick<DiffHunk, 'oldStart' | 'oldCount' | 'newStart' | 'newCount'>): string {
	return `${path}:${hunk.oldStart},${hunk.oldCount}:${hunk.newStart},${hunk.newCount}`;
}

/** Every entry the diff can show, by id: each hunk, and one for each file renamed with no hunk. */
function entries(files: readonly FileDiff[]): Map<string, Draft> {
	const known = new Map<string, Draft>();

	for (const file of files) {
		if (file.hunks.length === 0) {
			const id = `${file.path}:renamed-file`;

			known.set(id, { id, path: file.path, index: null, line: null, explanation: null, moved: false });
		}

		file.hunks.forEach((hunk, index) => {
			const id = hunkId(file.path, hunk);

			const line = hunk.newCount > 0 ? hunk.newStart : hunk.oldStart;

			known.set(id, { id, path: file.path, index, line, explanation: null, moved: false });
		});
	}

	return known;
}

/** Each hunk's place among its file's hunks, counted across every chapter in reading order. */
function placed(chapters: { number: number; hunks: Draft[] }[]): Chapter['hunks'][] {
	const byPath = new Map<string, number[]>();

	for (const chapter of chapters)
		for (const hunk of chapter.hunks) byPath.set(hunk.path, [...(byPath.get(hunk.path) ?? []), chapter.number]);

	const seen = new Map<string, number>();

	return chapters.map((chapter) =>
		chapter.hunks.map((hunk) => {
			const numbers = byPath.get(hunk.path) ?? [];
			const at = (seen.get(hunk.path) ?? 0) + 1;

			seen.set(hunk.path, at);

			return {
				...hunk,
				place: {
					at,
					of: numbers.length,
					elsewhere: [...new Set(numbers.filter((number) => number !== chapter.number))]
				}
			};
		})
	);
}

/**
 * The guide's chapters over the diff as it is now. A hunk the guide names that the diff no longer has is dropped, a
 * hunk named twice reads where it is named first, and every hunk the guide leaves out reads in a last chapter, in
 * the diff's order. A chapter left with no hunk is dropped.
 */
export function guideChapters(guide: DiffGuide, files: readonly FileDiff[]): Chapter[] {
	const known = entries(files);
	const taken = new Set<string>();

	const drafts = guide.groups.map((group) => ({
		id: group.id,
		title: group.title,
		explanation: group.explanation ?? null,
		hunks: group.hunks.flatMap((entry): Draft[] => {
			const hunk = known.get(entry.id);

			if (!hunk || taken.has(entry.id)) return [];

			taken.add(entry.id);

			return [
				{ ...hunk, explanation: entry.explanation ?? null, moved: entry.note !== undefined && hunk.index !== null }
			];
		})
	}));

	const rest = [...known.values()].filter((hunk) => !taken.has(hunk.id));

	if (rest.length > 0) {
		drafts.push({
			id: REST_ID,
			title: 'Everything else',
			explanation: 'Changes the guide does not place.',
			hunks: rest
		});
	}

	const kept = drafts
		.filter((draft) => draft.hunks.length > 0)
		.map((draft, index) => ({ ...draft, number: index + 1 }));

	const hunks = placed(kept);

	return kept.map((draft, index) => ({ ...draft, hunks: hunks[index] }));
}

/** A chapter's number as the guide shows it: `01`. */
export function chapterNumber(number: number): string {
	return String(number).padStart(2, '0');
}

/** `lines 18–24`: the lines a hunk shows on its new side, or on its old side when it only removes. */
export function hunkLines(hunk: DiffHunk): string {
	const [start, count] = hunk.newCount > 0 ? [hunk.newStart, hunk.newCount] : [hunk.oldStart, hunk.oldCount];
	const words = hunk.newCount > 0 ? 'lines' : 'removed lines';

	return count === 1 ? `${words.replace('lines', 'line')} ${start}` : `${words} ${start}–${start + count - 1}`;
}

/** Where else the hunk's file reads: `hunk 1 of 2 in this file · the other is in 04`, `new file`, or null. */
export function hunkWhere(hunk: ChapterHunk, file: FileDiff): string | null {
	if (hunk.place.of === 1) {
		const change = fileChange(file);

		return change === 'added' ? 'new file' : change === 'deleted' ? 'deleted file' : null;
	}

	const where = `hunk ${hunk.place.at} of ${hunk.place.of} in this file`;
	const others = hunk.place.elsewhere.map(chapterNumber).join(', ');

	if (others === '') return where;

	return hunk.place.of === 2 ? `${where} · the other is in ${others}` : `${where} · others in ${others}`;
}

/** Where a finding's note sits: the last line of its range, on the new side. */
interface Placed {
	line: number | null;
	endLine?: number | null;
}

/** True when the hunk shows the new-side line a finding's note sits under. */
function holds(hunk: DiffHunk, bug: Placed): boolean {
	const anchor = bug.endLine ?? bug.line;

	return hunk.lines.some((line) => line.type !== 'del' && line.newNo === anchor);
}

/**
 * The findings a hunk's card shows: those whose note sits on one of its lines. The file's first card in reading
 * order also takes the findings no hunk of the file shows, so each finding shows once.
 */
export function hunkBugs<T extends Placed>(bugs: readonly T[], file: FileDiff, hunk: ChapterHunk): T[] {
	const shown = hunk.index === null ? null : file.hunks[hunk.index];
	const first = hunk.place.at === 1;

	return bugs.filter((bug) =>
		shown && holds(shown, bug) ? true : first && !file.hunks.some((other) => holds(other, bug))
	);
}
