import { create } from 'zustand';

import type { PullRow } from '../pulls/types';
import type { ComposePick } from './types';

interface ComposePickState {
	pick: ComposePick | null;
	setPick: (pick: ComposePick | null) => void;
}

/** The pull request New will review. It holds for the visit, like the text, so coming back to the screen keeps it. */
export const useComposePick = create<ComposePickState>((set) => ({
	pick: null,
	setPick: (pick) => set({ pick })
}));

/** The pick for a listed pull request. */
export function pickOfRow(row: PullRow): ComposePick {
	return {
		target: { kind: 'pull', repoId: row.repoId, repoName: row.repoName, number: row.number, href: row.href },
		title: row.title
	};
}

/** What the picker's trigger says: `#214 Fix retry backoff`, or `api #214` for a pull request in a repository not tracked yet. */
export function pickLabel({ target, title }: ComposePick): string {
	if (target.kind === 'untracked') return `${target.repoName} #${target.number}`;

	return title ? `#${target.number} ${title}` : `#${target.number}`;
}
