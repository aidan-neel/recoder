import type { PullPage, PullState } from '@recoder/shared';
import { Collapsible, Pill, type PillTone } from '@recoder/ui';
import { GitBranchIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { Avatar } from '@/components/common/avatar';
import { PullMark, type PullMarkState } from '@/components/common/pull-mark';
import { AuthorLink } from '@/components/people/author-link';

interface StateFace {
	mark: PullMarkState;
	tone: PillTone;
	label: string;
}

const FACES: Record<PullState | 'draft', StateFace> = {
	open: { mark: 'open', tone: 'ok', label: 'Open' },
	draft: { mark: 'draft', tone: 'neutral', label: 'Draft' },
	merged: { mark: 'merged', tone: 'sent', label: 'Merged' },
	closed: { mark: 'closed', tone: 'danger', label: 'Closed' }
};

/** The face for the page's state; an open draft reads as a draft. */
function faceOf(page: PullPage): StateFace {
	return FACES[page.status.state === 'open' && page.status.draft ? 'draft' : page.status.state];
}

interface PullHeaderProps {
	page: PullPage;
	/** At the end of the title's row: the review and merge buttons. */
	actions: ReactNode;
	/** After the facts: the checks and the conflicts. */
	merge: ReactNode;
	/** Under the facts: the checks' list, which the checks fact opens. */
	children: ReactNode;
}

/**
 * One dense row: the pull request's title, its facts as badges (its state,
 * who wrote it and the branch it merges into from the branch it came from,
 * then whether it can merge) and the buttons that act on it. A long title gives way first; where the row is
 * too narrow, the facts take a line of their own. Only the state is coloured.
 * Where the review stands shows on the Review tab, not here.
 */
export function PullHeader({ page, actions, merge, children }: PullHeaderProps) {
	const face = faceOf(page);
	const { base, headRef } = page.pull;

	return (
		<header className="page-column pull-head">
			<Collapsible>
				<div className="pull-title-row">
					<h1 className="page-title">
						<span className="page-title-text">{page.pull.title}</span>
						<span className="pull-title-number">#{page.pull.number}</span>
					</h1>
					<div className="pull-facts">
						<Pill tone={face.tone} icon={<PullMark state={face.mark} />}>
							{face.label}
						</Pill>
						<Pill icon={<Avatar name={page.pull.author} src={page.pull.authorAvatarUrl} className="pill-avatar" />}>
							<AuthorLink login={page.pull.author} repoId={page.repoId} />
						</Pill>
						<Pill face="code" icon={<GitBranchIcon aria-hidden />} title={`${headRef} into ${base}`}>
							{base} ← {headRef}
						</Pill>
						{merge}
					</div>
					<div className="pull-actions">{actions}</div>
				</div>
				{children}
			</Collapsible>
		</header>
	);
}
