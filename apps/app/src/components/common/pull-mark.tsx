import { Icon, type IconName } from '@recoder/ui';

/** What the mark says about a pull request. */
export type PullMarkState = 'open' | 'draft' | 'merged' | 'closed';

const MARKS: Record<PullMarkState, IconName> = {
	open: 'pull_request',
	draft: 'pull_request',
	merged: 'merge',
	closed: 'pull_request'
};

/** The pull request mark, drawn and tinted for its state. Decorative: the state is always in words nearby. */
export function PullMark({ state = 'open' }: { state?: PullMarkState }) {
	return <Icon name={MARKS[state]} className="pull-mark" data-state={state} />;
}
