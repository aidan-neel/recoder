import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react';

/** What the mark says about a pull request. */
export type PullMarkState = 'open' | 'draft' | 'merged' | 'closed';

const MARKS = {
	open: GitPullRequest,
	draft: GitPullRequestDraft,
	merged: GitMerge,
	closed: GitPullRequestClosed
};

/** The pull request mark, drawn and tinted for its state. Decorative: the state is always in words nearby. */
export function PullMark({ state = 'open' }: { state?: PullMarkState }) {
	const Mark = MARKS[state];

	return <Mark aria-hidden className="pull-mark" data-state={state} />;
}
