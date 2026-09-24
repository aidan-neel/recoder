import { parseUnifiedDiff, type DiffHunk, type FileDiff } from '@recoder/shared';
import {
	classifyPath,
	extraExcludes,
	packageBoundary,
	type FileClassification
} from './review-scope.js';

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface InventoryHunk {
	id: string;
	header: string;
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
	additions: number;
	deletions: number;
}

export interface InventoryFile {
	path: string;
	oldPath?: string;
	status: ChangeStatus;
	language: string | null;
	packageId: string | null;
	classification: FileClassification;
	additions: number;
	deletions: number;
	hunks: InventoryHunk[];
	excludeReason?: string;
	summarize?: boolean;
}

export interface InstructionFile {
	path: string;
	excerpt: string;
	truncated: boolean;
}

export interface ReviewInventory {
	files: InventoryFile[];
	hunksById: Map<string, { file: InventoryFile; hunk: InventoryHunk }>;
	diffs: FileDiff[];
	instructionFiles: InstructionFile[];
	/** Trusted owner guidelines block (global + repo layer), when any are set. */
	guidelines: string | null;
	relatedPaths: string[];
	executable: boolean;
	docsOnly: boolean;
}

export function hunkId(path: string, hunk: DiffHunk): string {
	return `${path}:${hunk.oldStart},${hunk.oldCount}:${hunk.newStart},${hunk.newCount}`;
}

function changeStatus(file: FileDiff): ChangeStatus {
	const oldPath = file.hunks.length && file.additions === 0 && file.deletions > 0 ? file.path : undefined;
	if (file.deletions === 0 && file.additions > 0 && file.hunks.every((h) => h.oldStart === 0 || h.oldCount === 0)) {
		return 'added';
	}
	if (file.additions === 0 && file.deletions > 0 && file.hunks.every((h) => h.newStart === 0 || h.newCount === 0)) {
		return 'deleted';
	}
	void oldPath;
	return 'modified';
}

function hunkStats(hunk: DiffHunk): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;
	for (const line of hunk.lines) {
		if (line.type === 'add') additions++;
		else if (line.type === 'del') deletions++;
	}
	return { additions, deletions };
}

export function buildInventory(diff: string, extras: string[] = extraExcludes()): ReviewInventory {
	const diffs = parseUnifiedDiff(diff);
	const files: InventoryFile[] = [];
	const hunksById = new Map<string, { file: InventoryFile; hunk: InventoryHunk }>();
	for (const file of diffs) {
		const classified = classifyPath(file.path, extras);
		const hunks: InventoryHunk[] = file.hunks.map((hunk) => {
			const stats = hunkStats(hunk);
			return {
				id: hunkId(file.path, hunk),
				header: hunk.header,
				oldStart: hunk.oldStart,
				oldCount: hunk.oldCount,
				newStart: hunk.newStart,
				newCount: hunk.newCount,
				additions: stats.additions,
				deletions: stats.deletions
			};
		});
		const entry: InventoryFile = {
			path: file.path,
			status: changeStatus(file),
			language: classified.language,
			packageId: packageBoundary(file.path),
			classification: classified.classification,
			additions: file.additions,
			deletions: file.deletions,
			hunks,
			excludeReason: classified.excludeReason,
			summarize: classified.summarize
		};
		files.push(entry);
		for (const hunk of hunks) hunksById.set(hunk.id, { file: entry, hunk });
	}
	const reviewable = files.filter((file) => !file.excludeReason);
	const executable = reviewable.some(
		(file) => file.classification === 'source' || file.classification === 'test' || file.classification === 'config'
	);
	const docsOnly = reviewable.length > 0 && reviewable.every((file) => file.classification === 'docs');
	return {
		files,
		hunksById,
		diffs,
		instructionFiles: [],
		guidelines: null,
		relatedPaths: [],
		executable,
		docsOnly
	};
}

export function inventorySummary(inventory: ReviewInventory, maxFiles = 200): string {
	const ranked = [...rankFiles(eligibleFiles(inventory)), ...inventory.files.filter((file) => file.excludeReason)];
	const rows = ranked.slice(0, maxFiles).map((file) => {
		const mark = file.excludeReason ? ` excluded:${file.excludeReason}` : file.summarize ? ' summarize' : '';
		return `${file.status} ${file.path} +${file.additions} -${file.deletions} [${file.classification}${file.packageId ? ` ${file.packageId}` : ''}${mark}] ${file.hunks.length} hunks (use hunkIds: [] for whole file)`;
	});
	const extra = inventory.files.length > maxFiles ? `\n…${inventory.files.length - maxFiles} more files` : '';
	return rows.join('\n') + extra;
}

export function eligibleFiles(inventory: ReviewInventory): InventoryFile[] {
	return inventory.files.filter((file) => !file.excludeReason);
}

export function rankFiles(files: InventoryFile[]): InventoryFile[] {
	return [...files].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions) || a.path.localeCompare(b.path));
}
