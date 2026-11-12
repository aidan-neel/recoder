import { byCodePoint, type ContextOmission, type DiffHunk, type DiffLine } from '@recoder/shared';
import type { CoverageLedger } from '../coverage.js';
import type { InventoryFile, ReviewInventory } from '../inventory.js';
import { patchLineChars } from '../units.js';

/** Priority order when `maxFiles` or `maxDiffChars` trims the change: source code first, docs last. */
const CLASS_RANK: Record<InventoryFile['classification'], number> = {
	source: 0,
	config: 1,
	test: 2,
	other: 3,
	docs: 4,
	generated: 5,
	lockfile: 6,
	binary: 7
};

type InventoryHunk = InventoryFile['hunks'][number];

/** Line range of a hunk on the new side, or on the old side for a deletion. */
function hunkRange(hunk: Pick<InventoryHunk, 'oldStart' | 'oldCount' | 'newStart' | 'newCount'>): {
	startLine?: number;
	endLine?: number;
} {
	const newSide = hunk.newCount > 0 || hunk.newStart > 0;
	const start = newSide ? hunk.newStart : hunk.oldStart;
	const count = newSide ? hunk.newCount : hunk.oldCount;

	return start > 0 ? { startLine: start, endLine: start + Math.max(count - 1, 0) } : {};
}

/** Patch characters in one hunk of the diff. */
function hunkChars(hunk: DiffHunk): number {
	return hunk.lines.reduce((sum, line) => sum + patchLineChars(line), 0);
}

/** Excludes a whole file from review, clearing its diff hunks while recording each hunk in omissions and coverage. */
function omitWholeFile(
	inventory: ReviewInventory,
	coverage: CoverageLedger,
	file: InventoryFile,
	reason: 'file-cap' | 'diff-cap',
	why: string,
	omitted: ContextOmission[]
): void {
	file.excludeReason = why;

	const diff = inventory.diffs.find((entry) => entry.path === file.path);

	if (diff) diff.hunks = [];

	for (const hunk of file.hunks) {
		inventory.hunksById.delete(hunk.id);
		coverage.exclude(hunk.id, file.path, why);
		omitted.push({ kind: 'diff', path: file.path, ...hunkRange(hunk), reason, why });
	}
}

/** Clips an oversized first hunk to `maxChars` so a single-hunk diff over the cap still gets reviewed within the cap. */
function clipFirstHunk(
	inventory: ReviewInventory,
	file: InventoryFile,
	invHunk: InventoryHunk,
	diffHunk: DiffHunk,
	maxChars: number,
	why: string,
	coverage: CoverageLedger,
	omitted: ContextOmission[]
): void {
	const oldId = invHunk.id;
	const origRange = hunkRange(invHunk);
	const kept: DiffLine[] = [];
	let used = 0;

	for (const line of diffHunk.lines) {
		const chars = patchLineChars(line);

		if (used + chars <= maxChars) {
			kept.push(line);
			used += chars;
		} else break;
	}

	if (kept.length === 0 && diffHunk.lines.length > 0) {
		const first = diffHunk.lines[0];

		kept.push({ ...first, text: first.text.slice(0, Math.max(0, maxChars - 2)) });
	}

	diffHunk.lines = kept;
	diffHunk.oldCount = kept.filter((line) => line.type !== 'add').length;
	diffHunk.newCount = kept.filter((line) => line.type !== 'del').length;
	diffHunk.header = `@@ -${diffHunk.oldStart},${diffHunk.oldCount} +${diffHunk.newStart},${diffHunk.newCount} @@`;
	invHunk.oldCount = diffHunk.oldCount;
	invHunk.newCount = diffHunk.newCount;
	invHunk.header = diffHunk.header;
	invHunk.id = `${file.path}:${diffHunk.oldStart},${diffHunk.oldCount}:${diffHunk.newStart},${diffHunk.newCount}`;
	invHunk.additions = kept.filter((line) => line.type === 'add').length;
	invHunk.deletions = kept.filter((line) => line.type === 'del').length;

	inventory.hunksById.delete(oldId);
	inventory.hunksById.set(invHunk.id, { file, hunk: invHunk });

	const keptRange = hunkRange(invHunk);

	const range =
		origRange.startLine !== undefined && origRange.endLine !== undefined
			? {
					startLine:
						keptRange.endLine !== undefined ? Math.min(keptRange.endLine + 1, origRange.endLine) : origRange.startLine,
					endLine: origRange.endLine
				}
			: {};

	coverage.exclude(`${oldId}#diff-cap`, file.path, why);
	omitted.push({ kind: 'diff', path: file.path, ...range, reason: 'diff-cap', why });
}

/** Updates a file's hunk lists and line-change totals after `maxDiffChars` drops or clips hunks. */
function syncKeptHunks(
	inventory: ReviewInventory,
	file: InventoryFile,
	keptInv: InventoryHunk[],
	keptDiff: DiffHunk[]
): void {
	const keptIds = new Set(keptInv.map((hunk) => hunk.id));

	for (const hunk of file.hunks) {
		if (!keptIds.has(hunk.id)) inventory.hunksById.delete(hunk.id);
	}

	file.hunks = keptInv;
	file.additions = keptInv.reduce((sum, hunk) => sum + hunk.additions, 0);
	file.deletions = keptInv.reduce((sum, hunk) => sum + hunk.deletions, 0);

	const diff = inventory.diffs.find((entry) => entry.path === file.path);

	if (diff) {
		diff.hunks = keptDiff;
		diff.additions = file.additions;
		diff.deletions = file.deletions;
	}
}

const EXECUTABLE_CLASSES = new Set<InventoryFile['classification']>(['source', 'test', 'config']);

/** Recomputes `executable` and `docsOnly` on the inventory after limits exclude files. */
function refreshInventoryFlags(inventory: ReviewInventory): void {
	const active = inventory.files.filter((entry) => !entry.excludeReason);

	inventory.executable = active.some((entry) => EXECUTABLE_CLASSES.has(entry.classification));
	inventory.docsOnly = active.length > 0 && active.every((entry) => entry.classification === 'docs');
}

/**
 * Enforces `maxFiles` and `maxDiffChars` on `inventory` before units and budgets
 * are sized, recording every omitted file, hunk or clipped tail in both
 * `coverage` and the returned `ContextOmission` list so nothing is dropped silently.
 */
export function applyDiffLimits(
	inventory: ReviewInventory,
	coverage: CoverageLedger,
	limits: { maxFiles: number; maxDiffChars: number }
): ContextOmission[] {
	const omitted: ContextOmission[] = [];

	const candidates = inventory.files
		.filter((file) => !file.excludeReason && !file.summarize && file.hunks.length > 0)
		.sort((a, b) => CLASS_RANK[a.classification] - CLASS_RANK[b.classification] || byCodePoint(a.path, b.path));

	const fileReason = `exceeds maxFiles limit (${limits.maxFiles})`;

	for (const file of candidates.slice(limits.maxFiles)) {
		omitWholeFile(inventory, coverage, file, 'file-cap', fileReason, omitted);
	}

	const diffReason = `exceeds maxDiffChars limit (${limits.maxDiffChars})`;
	let usedChars = 0;

	for (const file of candidates.slice(0, limits.maxFiles)) {
		const diff = inventory.diffs.find((entry) => entry.path === file.path);

		if (!diff) continue;

		const keptInv: InventoryHunk[] = [];
		const keptDiff: DiffHunk[] = [];
		let clipped = false;

		for (let i = 0; i < file.hunks.length; i++) {
			const invHunk = file.hunks[i];
			const diffHunk = diff.hunks[i];

			if (!diffHunk) continue;

			const chars = hunkChars(diffHunk);

			if (usedChars + chars <= limits.maxDiffChars) {
				keptInv.push(invHunk);
				keptDiff.push(diffHunk);
				usedChars += chars;
			} else if (usedChars === 0 && keptInv.length === 0 && limits.maxDiffChars > 0) {
				clipFirstHunk(inventory, file, invHunk, diffHunk, limits.maxDiffChars, diffReason, coverage, omitted);
				keptInv.push(invHunk);
				keptDiff.push(diffHunk);
				usedChars = limits.maxDiffChars;
				clipped = true;
			} else {
				coverage.exclude(invHunk.id, file.path, diffReason);
				omitted.push({ kind: 'diff', path: file.path, ...hunkRange(invHunk), reason: 'diff-cap', why: diffReason });
			}
		}

		if (keptInv.length === 0) {
			file.excludeReason = diffReason;
			diff.hunks = [];
			for (const hunk of file.hunks) inventory.hunksById.delete(hunk.id);
		} else if (clipped || keptInv.length < file.hunks.length) {
			syncKeptHunks(inventory, file, keptInv, keptDiff);
		}
	}

	if (omitted.length) refreshInventoryFlags(inventory);

	return omitted;
}
