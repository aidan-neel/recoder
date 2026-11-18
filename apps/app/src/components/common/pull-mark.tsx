import { GitMergeIcon, GitPullRequestIcon } from '@phosphor-icons/react';

/** What the mark says about a pull request. */
export type PullMarkState = 'open' | 'draft' | 'merged' | 'closed';

const MARKS = {
	open: GitPullRequestIcon,
	draft: GitPullRequestIcon,
	merged: GitMergeIcon,
	closed: GitPullRequestIcon
};

/** The pull request mark, drawn and tinted for its state. Decorative: the state is always in words nearby. */
export function PullMark({ state = 'open' }: { state?: PullMarkState }) {
	const Mark = MARKS[state];

	return <Mark aria-hidden className="pull-mark" data-state={state} />;
}
