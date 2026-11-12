import { parseUnifiedDiff, type DiffLine, type Finding } from '@recoder/shared';
import { fenceBlock } from '../../cli/output/markdown-code';
import type { InlineTarget } from './forge';

/** The most changed lines (removed plus added) a patch may have to be offered as a one-click suggestion. */
const MAX_SUGGESTION_LINES = 20;

/**
 * A finding's checked patch as a forge suggestion: the head lines it replaces
 * (the comment's anchor is the last one, `span` lines below the first) and the
 * text that replaces them.
 */
export interface SuggestedChange {
	target: InlineTarget;
	span: number;
	replacement: string;
}

/**
 * The finding's patch as a suggestion, or null unless the patch is small, is
 * one replacement in the finding's own file that covers the finding's lines,
 * and every line it replaces is shown in the pull request's diff (forges only
 * take suggestions on shown lines). Anything else would be a partial fix.
 */
export function suggestedChange(finding: Finding, pullDiff: string | undefined): SuggestedChange | null {
	if (!finding.patch || !pullDiff || finding.side === 'old') return null;

	const files = parseUnifiedDiff(finding.patch.diff);
	const hunks = files.length === 1 && files[0].path === finding.file ? files[0].hunks : [];

	if (hunks.length !== 1) return null;

	const changed = changedBlock(hunks[0].lines);

	if (!changed || !coversFinding(finding, changed.first, changed.last)) return null;

	const target = shownRange(finding.file, changed.first, changed.last, pullDiff);

	return target ? { target, span: changed.last - changed.first, replacement: changed.replacement } : null;
}

/** The suggestion block for a forge: GitHub replaces the comment's line range, GitLab counts lines above the anchor. */
export function suggestionBlock(provider: 'github' | 'gitlab', change: SuggestedChange): string {
	const language = provider === 'gitlab' ? `suggestion:-${change.span}+0` : 'suggestion';

	return fenceBlock(change.replacement, language);
}

/**
 * The hunk's one run of removed and added lines with context only around it:
 * the head lines it removes and what it adds instead. Null for more than one
 * run, a pure insertion or deletion, more than the size cap, or replacement
 * text whose trailing whitespace a fenced block would lose.
 */
function changedBlock(lines: DiffLine[]): { first: number; last: number; replacement: string } | null {
	const changedAt = lines.flatMap((line, index) => (line.type === 'context' ? [] : [index]));
	const block = changedAt.length ? lines.slice(changedAt[0], changedAt[changedAt.length - 1] + 1) : [];

	if (!block.length || block.length > MAX_SUGGESTION_LINES || block.some((line) => line.type === 'context'))
		return null;

	const removed = block.flatMap((line) => (line.type === 'del' && line.oldNo !== null ? [line.oldNo] : []));
	const replacement = block.flatMap((line) => (line.type === 'add' ? [line.text] : [])).join('\n');

	if (!removed.length || removed.length === block.length || replacement !== replacement.trimEnd()) return null;

	return { first: removed[0], last: removed[removed.length - 1], replacement };
}

/** Whether the replaced lines overlap the lines the finding points at, so the suggestion fixes what the comment says. */
function coversFinding(finding: Finding, first: number, last: number): boolean {
	if (!finding.line) return false;

	const end = Math.max(finding.line, finding.endLine ?? finding.line);

	return finding.line <= last && end >= first;
}

/** The anchor for lines `first`..`last` of the head file when one hunk of the pull request's diff shows them all. */
function shownRange(path: string, first: number, last: number, pullDiff: string): InlineTarget | null {
	const file = parseUnifiedDiff(pullDiff).find((entry) => entry.path === path);

	for (const hunk of file?.hunks ?? []) {
		const shown = hunk.lines.filter((line) => line.type !== 'del');
		const top = shown.find((line) => line.newNo === first);
		const bottom = shown.find((line) => line.newNo === last);

		if (top && bottom) return { path, oldPath: path, side: 'new', oldLine: bottom.oldNo, newLine: last };
	}

	return null;
}
