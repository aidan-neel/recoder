import type { RowEntry } from './use-rows';

/**
 * How many of a pull request's open findings are bugs: not warnings, suggestions or FYI, not decided or quieted.
 * Only a row that shows its findings counts them, so a review of an older head or one still running counts none.
 */
export function openBugs({ row }: RowEntry): number {
	return row.status.kind === 'bugs' ? row.status.bugs : 0;
}
