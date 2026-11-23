import type { DiffMove } from '@recoder/shared';
import type { ReviewInventory } from './inventory';

/** Exact content identity requires a new-context explanation before an inherited issue can become a defect. */
export function pureMoveAt(
	inventory: ReviewInventory,
	path: string,
	line: number | undefined,
	side: 'old' | 'new' = 'new'
): DiffMove | undefined {
	if (line === undefined || !inventory.moves?.length) return;

	const sourcePath = side === 'old' ? (inventory.files.find((file) => file.path === path)?.oldPath ?? path) : path;

	return inventory.moves.find((move) => {
		const range = side === 'new' ? move.toLines : move.fromLines;
		const source = side === 'new' ? move.toPath : move.fromPath;

		return move.exact && source === sourcePath && range.start <= line && (range.end === null || line <= range.end);
	});
}
