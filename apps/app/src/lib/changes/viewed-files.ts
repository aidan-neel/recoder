import type { FileDiff } from '@recoder/shared';

import { readStoredJson, writeStored } from '../shell/browser-storage';

/** Viewed files of one pull request: each path with the hash of the diff it had when marked. */
export type ViewedMarks = Record<string, string>;

/** The storage key of one pull request's viewed files. */
export function viewedKey(repoId: string, number: number): string {
	return `recoder.viewed.v1.${repoId}#${number}`;
}

/** A short FNV-1a hash of the file's diff lines, so a file whose diff changed reads as not viewed. */
function diffHash(file: FileDiff): string {
	let hash = 0x811c9dc5;

	for (const hunk of file.hunks) {
		for (const line of hunk.lines) {
			const text = `${line.type}${line.text}\n`;

			for (let index = 0; index < text.length; index++) {
				hash ^= text.charCodeAt(index);
				hash = Math.imul(hash, 0x01000193);
			}
		}
	}

	return (hash >>> 0).toString(36);
}

/** The viewed marks saved for the pull request; none when there are none, they do not parse, or storage is blocked. */
export function readViewed(key: string): ViewedMarks {
	const raw = readStoredJson(key);

	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

	return Object.fromEntries(
		Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
	);
}

/** Saves the marks; blocked or full storage keeps them for this page only. */
export function writeViewed(key: string, marks: ViewedMarks): void {
	writeStored(key, JSON.stringify(marks));
}

/** The marks with the file marked viewed at its current diff, or unmarked when it was viewed. */
export function toggleViewed(marks: ViewedMarks, file: FileDiff): ViewedMarks {
	const hash = diffHash(file);
	const { [file.path]: previous, ...rest } = marks;

	return previous === hash ? rest : { ...rest, [file.path]: hash };
}

/** True when the file was marked viewed at the diff it has now. */
export function isViewedAt(marks: ViewedMarks, file: FileDiff): boolean {
	return marks[file.path] === diffHash(file);
}
