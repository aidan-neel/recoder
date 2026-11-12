import type { PullPage, PullState } from '@recoder/shared';
import { Pill, type PillTone } from '@recoder/ui';

import { author, plural } from '@/lib/shell/format';

import { PullMark, type PullMarkState } from '@/components/common/pull-mark';

interface StateFace {
	mark: PullMarkState;
	tone: PillTone;
	label: string;
	/** What the author did, or wants: the verb between their name and the branches. */
	verb: string;
}

const FACES: Record<PullState | 'draft', StateFace> = {
	open: { mark: 'open', tone: 'ok', label: 'Open', verb: 'wants to merge' },
	draft: { mark: 'draft', tone: 'neutral', label: 'Draft', verb: 'is working on' },
	merged: { mark: 'merged', tone: 'sent', label: 'Merged', verb: 'merged' },
	closed: { mark: 'closed', tone: 'danger', label: 'Closed', verb: 'wanted to merge' }
};

/** The face for the page's state; an open draft reads as a draft. */
function faceOf(page: PullPage): StateFace {
	return FACES[page.status.state === 'open' && page.status.draft ? 'draft' : page.status.state];
}

/** `14 commits`, or `changes` when the forge gives no count. */
function commitsText(commits: number | null): string {
	return commits === null ? 'changes' : plural(commits, 'commit');
}

/** The pull request's title, its state, and who wants to merge what into where. */
export function PullHeader({ page }: { page: PullPage }) {
	const face = faceOf(page);
	const by = author(page.pull.author);

	return (
		<header className="page-head">
			<h1 className="page-title">
				<span className="page-title-text">{page.pull.title}</span>
				<span className="pull-title-number">#{page.pull.number}</span>
			</h1>
			<div className="pull-facts">
				<Pill tone={face.tone} icon={<PullMark state={face.mark} />}>
					{face.label}
				</Pill>
				<span>
					<strong>{by.name}</strong> {face.verb} {commitsText(page.status.commits)} into
				</span>
				<span className="ref-chip" title={page.pull.base}>
					{page.pull.base}
				</span>
				<span>from</span>
				<span className="ref-chip" title={page.pull.headRef}>
					{page.pull.headRef}
				</span>
			</div>
		</header>
	);
}
