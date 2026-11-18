import type { EvidenceStore } from '../../../evidence/evidence.js';
import type { ReviewUnit } from '../units.js';
import type { PoolContext } from './pool.js';

/** Tool results for the scoped patch a reviewer starts with. */
export type ScopedPatch = Awaited<ReturnType<EvidenceStore['executeRound']>>;

/**
 * The first bounded patch page for every scoped file, supplied up front instead of
 * spending a model round asking for it. Every file gets a result (truncated once
 * the round budget is spent), so none silently drops out past the per-turn action limit.
 */
export function readScopedPatch(
	item: ReviewUnit,
	role: string,
	ctx: PoolContext,
	roundChars?: number
): Promise<ScopedPatch> {
	return ctx.evidence.executeRound(
		item.scope.map((entry) => ({ action: 'readDiff', path: entry.path, hunkIds: entry.hunkIds })),
		ctx.signal,
		(tool) => ctx.events?.onTool?.({ ...tool, assignmentId: item.id, role }),
		item.scope.length,
		undefined,
		0,
		roundChars
	);
}

/**
 * The hunks the first patch round did not reach, named so a reviewer of a large slice pages them itself and does
 * not list them as examined unread. Empty when the round held the whole scope.
 */
export function unreadHunks(item: ReviewUnit, patch: ScopedPatch): string {
	const lines = item.scope.flatMap((entry) => {
		const result = patch.find((candidate) => candidate.path === entry.path);
		const shown = new Set(result?.ok ? result.hunkIds : []);
		const unread = entry.hunkIds.filter((hunkId) => !shown.has(hunkId));

		return unread.length ? [`- ${entry.path}: ${unread.join(', ')}`] : [];
	});

	if (!lines.length) return '';

	return `\n\nThe first patch page did not reach these hunks. Read them with readDiff (the path and hunkIds, or the cursor of a truncated result) before you list them as examined:\n${lines.join('\n')}`;
}
