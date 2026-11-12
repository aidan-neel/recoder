import type { LinkFacts } from '@recoder/ui/form';

import type { PullRow, PullTarget, RepoOption } from '../pulls/types';

/** The New review screen: name a pull request, then start its review. */
export interface ComposeView {
	/**
	 * What the person typed: a pull request URL, `#158` or `158`, or a branch
	 * name, then optionally what the review should look at
	 * (`#158 look at the lease handling`).
	 */
	text: string;
	setText: (text: string) => void;
	/** What the text points at, resolved as the person types. A number or a branch is looked up in `repoId`. */
	target: PullTarget;
	/** The part of the text after the target; null when there is none. */
	brief: string | null;
	/** What the field's embeds show: the target link's state, and what the list knows about other links. */
	linkFacts: LinkFacts;
	repos: RepoOption[];
	/** The repository a number or a branch is looked up in; the last one used, else the first tracked. */
	repoId: string | null;
	setRepoId: (repoId: string) => void;
	/** Open pull requests with no review at their current head, newest first; at most six. */
	suggestions: PullRow[];
	/** True while the suggestions load for the first time. */
	loading: boolean;
	/**
	 * Starts the review of `target` (tracking its repository first when it is
	 * not tracked) and resolves with the pull request page to open. It rejects
	 * with a plain sentence when the target is not a pull request or the start
	 * fails.
	 */
	submit: () => Promise<string>;
	/** Starts the review of a suggested row; resolves with its page. */
	submitRow: (row: PullRow) => Promise<string>;
	submitting: boolean;
}
