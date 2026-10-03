import { splitFileLines, type FileDiff } from '@recoder/shared';
import { REVIEW_POLICY } from '../review/session/review-policy.js';
import type { RevisionAlias, ToolResult } from './types.js';

/** The index just after `cursor` in `items`, or 0 when there is no cursor or it is unknown. */
export function cursorIndex(items: string[], cursor?: string): number {
	if (!cursor) return 0;

	const index = items.indexOf(cursor);

	return index >= 0 ? index + 1 : 0;
}

/** One page of paths after `cursor`, continuing from the last path shown. */
export function paginateList(action: string, revision: RevisionAlias, paths: string[], cursor?: string): ToolResult {
	const start = cursorIndex(paths, cursor);
	const page = paths.slice(start, start + REVIEW_POLICY.maxListPage);
	const truncated = start + page.length < paths.length;

	return {
		action,
		ok: true,
		revision,
		content: page.join('\n'),
		truncated,
		continuation: truncated ? (page.at(-1) ?? null) : null,
		matches: page.length
	};
}

/** A `readFile` result of numbered lines, capped to `maxChars` and the round budget. */
export function sliceLines(
	text: string,
	startLine: number,
	endLine: number,
	revision: RevisionAlias,
	path: string,
	maxChars: number
): ToolResult {
	const lines = splitFileLines(text);

	if (startLine > lines.length) {
		return {
			action: 'readFile',
			ok: false,
			error: `startLine ${startLine} is past end of file (${lines.length} lines)`,
			content: '',
			truncated: false,
			revision,
			path
		};
	}

	const slice = lines.slice(startLine - 1, Math.min(endLine, lines.length));
	const numbered = slice.map((line, i) => `${startLine + i}|${line}`).join('\n');
	const cap = Math.min(maxChars, REVIEW_POLICY.maxToolRoundChars);

	const truncated =
		numbered.length > cap ||
		(endLine < Math.min(endLine, lines.length) &&
			startLine + slice.length - 1 < lines.length &&
			endLine < lines.length);

	const content = numbered.length > cap ? numbered.slice(0, cap) : numbered;

	return {
		action: 'readFile',
		ok: true,
		revision,
		path,
		startLine,
		endLine: startLine + slice.length - 1,
		content,
		truncated: truncated || numbered.length > cap,
		continuation:
			startLine + slice.length <= lines.length && (endLine < lines.length || numbered.length > cap)
				? String(startLine + slice.length)
				: null
	};
}

/** The whole new-side file rebuilt from its hunks, or null when the hunks leave gaps or nothing remains. */
export function newSideText(file: FileDiff): string | null {
	const byNumber = new Map<number, string>();
	let max = 0;

	for (const hunk of file.hunks) {
		for (const line of hunk.lines) {
			if (line.newNo === null) continue;

			byNumber.set(line.newNo, line.text);

			if (line.newNo > max) max = line.newNo;
		}
	}

	if (max === 0) return null;

	const lines: string[] = [];

	for (let n = 1; n <= max; n++) {
		if (!byNumber.has(n)) return null;

		lines.push(byNumber.get(n)!);
	}

	return lines.join('\n');
}
