import type { PullPage, PullState } from '@recoder/shared';
import { Pill, type PillTone } from '@recoder/ui';
import { Clock, GitBranch } from 'lucide-react';

import { author } from '@/lib/shell/format';

import { Age } from '@/components/common/age';
import { Avatar } from '@/components/common/avatar';
import { DiffStat } from '@/components/common/diff-stat';
import { PullMark, type PullMarkState } from '@/components/common/pull-mark';

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

/**
 * The pull request's title over its facts as badges: its state, who wrote
 * it, the branch it merges into from the branch it came from, the size of the
 * change and when it last moved. Only the state is coloured.
 */
export function PullHeader({ page }: { page: PullPage }) {
	const face = faceOf(page);
	const by = author(page.pull.author);
	const { base, headRef } = page.pull;

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
				<Pill icon={<Avatar name={by.name} className="pill-avatar" />}>{by.name}</Pill>
				<Pill face="code" icon={<GitBranch aria-hidden />} title={`${headRef} into ${base}`}>
					{base} ← {headRef}
				</Pill>
				{page.pull.additions + page.pull.deletions > 0 ? (
					<Pill face="code">
						<DiffStat additions={page.pull.additions} deletions={page.pull.deletions} />
					</Pill>
				) : null}
				<Pill icon={<Clock aria-hidden />}>
					<Age at={page.status.updatedAt} form="long" />
				</Pill>
			</div>
		</header>
	);
}
