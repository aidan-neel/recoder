import type { DiffHunk, FileDiff } from '@recoder/shared';

import type { BugView } from '../bugs/types';

/** A place an address can name in the Changes tab: a file, a line of it, or a finding. */
export type ChangesPlace =
	{ kind: 'file'; path: string; line: number | null; side: 'old' | 'new' } | { kind: 'finding'; id: string };

/** The last new-side line a hunk shows. */
function hunkEnd(hunk: DiffHunk): number {
	return hunk.newStart + hunk.newCount - 1;
}

/**
 * How many unchanged lines the diff leaves out before each hunk: the lines above the first one and the lines
 * between one hunk and the next, counted on the new side. A deleted file's hunk has no new side and hides none.
 */
export function hiddenBefore(file: FileDiff): number[] {
	return file.hunks.map((hunk, index) => {
		if (hunk.newCount === 0) return 0;

		const previous = file.hunks[index - 1];
		const shown = previous && previous.newCount > 0 ? hunkEnd(previous) : 0;

		return Math.max(0, hunk.newStart - shown - 1);
	});
}

/**
 * The place an address's hash names: `#file=<path>`, `#file=<path>&line=<n>`, `#file=<path>&old=<n>` (a removed
 * line) or `#finding=<id>`. Anything else, a line that is not a positive whole number included, names no line or
 * nothing.
 */
export function readPlace(hash: string): ChangesPlace | null {
	const params = new URLSearchParams(hash.replace(/^#/, ''));
	const finding = params.get('finding');
	const path = params.get('file');

	if (finding) return { kind: 'finding', id: finding };
	if (!path) return null;

	const old = params.get('old');
	const line = old ?? params.get('line');

	return {
		kind: 'file',
		path,
		line: line && /^[1-9]\d{0,6}$/.test(line) ? Number(line) : null,
		side: old === null ? 'new' : 'old'
	};
}

/** The hash that names a place, for an address someone can share. */
export function placeHash(place: ChangesPlace): string {
	const params = new URLSearchParams();

	if (place.kind === 'finding') params.set('finding', place.id);
	else {
		params.set('file', place.path);

		if (place.line !== null) params.set(place.side === 'old' ? 'old' : 'line', String(place.line));
	}

	return `#${params.toString()}`;
}

/** The findings in reading order: by the file's place in `order`, then by line; one the diff does not hold goes last. */
export function readingOrder(bugs: BugView[], order: string[]): BugView[] {
	const rank = new Map(order.map((path, index) => [path, index]));

	return [...bugs].sort(
		(a, b) =>
			(rank.get(a.file) ?? order.length) - (rank.get(b.file) ?? order.length) ||
			(a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER)
	);
}
