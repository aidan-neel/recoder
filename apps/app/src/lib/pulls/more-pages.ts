import type { PullList, PullListItem } from '@recoder/shared';

/**
 * The pull requests read past the first page of each repository, in the order
 * they arrived, and where each repository's next page starts.
 */
export interface MorePages {
	items: PullListItem[];
	/** The cursor of each repository's next page; a repository with no more is absent. */
	cursors: Record<string, string>;
	loading: boolean;
	/** Why the newest read of more pages failed; null once a read works. */
	error: string | null;
}

export const NO_MORE_PAGES: MorePages = { items: [], cursors: {}, loading: false, error: null };

/**
 * The pages after the first list was read again. A repository already read
 * past its first page keeps its place; the others start from the new list's
 * cursors.
 */
export function afterReload(more: MorePages, list: PullList): MorePages {
	const progressed = new Set(more.items.map((item) => item.repoId));
	const cursors: Record<string, string> = {};

	for (const [repoId, cursor] of Object.entries(list.nextCursors)) {
		if (!progressed.has(repoId)) cursors[repoId] = cursor;
	}

	for (const [repoId, cursor] of Object.entries(more.cursors)) {
		if (progressed.has(repoId)) cursors[repoId] = cursor;
	}

	return { ...more, cursors };
}

/** `more` with the page read for `repoId` appended after the rows already shown, and that repository's cursor moved on. */
export function afterPage(more: MorePages, repoId: string, page: PullList): MorePages {
	const cursors = Object.fromEntries(Object.entries(more.cursors).filter(([id]) => id !== repoId));
	const next = page.nextCursors[repoId];

	return {
		...more,
		items: [...more.items, ...page.items],
		cursors: next === undefined ? cursors : { ...cursors, [repoId]: next }
	};
}
