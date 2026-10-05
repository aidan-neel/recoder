import type { ChangeModel } from '../change-model/types.js';
import type { ReviewInventory } from '../inventory.js';
import type { DetectorResult } from './types.js';

/** Changed path → its added new-side lines (line number → text), in line order. */
export type AddedLines = Map<string, Map<number, string>>;

/**
 * The lines the diff adds, per reviewable file. Excluded and deleted files are
 * left out, so detectors only ever report on code the review covers.
 */
export function addedLines(inventory: ReviewInventory): AddedLines {
	const reviewable = new Set(
		inventory.files.filter((file) => !file.excludeReason && file.status !== 'deleted').map((file) => file.path)
	);

	const added: AddedLines = new Map();

	for (const diff of inventory.diffs) {
		if (!reviewable.has(diff.path)) continue;

		const lines = new Map<number, string>();

		for (const hunk of diff.hunks)
			for (const line of hunk.lines) if (line.type === 'add' && line.newNo !== null) lines.set(line.newNo, line.text);

		if (lines.size) added.set(diff.path, lines);
	}

	return added;
}

/** The innermost changed symbol around a line, by qualified name. */
export function enclosingSymbol(model: ChangeModel | null, file: string, line: number): string | undefined {
	const around = (model?.symbols ?? []).filter(
		(symbol) =>
			symbol.file === file && symbol.change !== 'deleted' && symbol.startLine <= line && line <= symbol.endLine
	);

	around.sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine) || a.startLine - b.startLine);

	return around[0]?.qualifiedName;
}

/** Plain code-point order, the same on every machine and locale. */
export function compareText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** File, then line, then detector: the order results are reported in. */
export function compareResults(a: DetectorResult, b: DetectorResult): number {
	return compareText(a.file, b.file) || a.line - b.line || compareText(a.detector, b.detector);
}

/** Text clipped to `max` characters, with an ellipsis when cut. */
export function clip(text: string, max: number): string {
	const flat = text.replace(/\s+/g, ' ').trim();

	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
