import { DiffStat, HoverList, RowButton, SkeletonRows } from '@recoder/ui';

import type { ComposeList, PickTarget } from '@/lib/compose/types';
import type { PullRow } from '@/lib/pulls/types';

import { PullMark } from '@/components/common/pull-mark';
import { PullMeta } from '@/components/common/pull-meta';
import { StatusPill } from '@/components/pulls/pull-status';

import { ComposeEmpty, ComposeGroup } from './compose-group';

/** How many placeholder rows stand in while the pull requests load for the first time. */
const LOADING_ROWS = 4;

/** A choice row's height in px, which its placeholder shares. */
const ROW_HEIGHT = 48;

interface PullChoicesProps {
	list: Pick<ComposeList, 'unreviewed' | 'reviewed' | 'query' | 'repoId'>;
	loading: boolean;
	/** The pull request chosen, whose row is marked. */
	picked: PickTarget | null;
	onPick: (row: PullRow) => void;
}

/**
 * The open pull requests New can review, those with no review yet first: a
 * click chooses one, as its mark shows, and the brief goes in the composer
 * under them.
 */
export function PullChoices({ list, loading, picked, onPick }: PullChoicesProps) {
	if (loading) {
		return (
			<ComposeGroup title="Not reviewed yet">
				<SkeletonRows count={LOADING_ROWS} height={ROW_HEIGHT} glyph rowClassName="compose-row" />
			</ComposeGroup>
		);
	}

	if (list.unreviewed.length + list.reviewed.length === 0) {
		const narrowed = list.query.trim() !== '' || list.repoId !== null;

		return <ComposeEmpty>{narrowed ? 'No pull request matches.' : 'No open pull requests.'}</ComposeEmpty>;
	}

	return (
		<HoverList className="compose-groups" itemSelector="[data-choice]" selectedSelector="[data-current]">
			<ChoiceGroup title="Not reviewed yet" rows={list.unreviewed} picked={picked} onPick={onPick} />
			<ChoiceGroup title="Reviewed" rows={list.reviewed} picked={picked} onPick={onPick} />
		</HoverList>
	);
}

interface ChoiceGroupProps extends Pick<PullChoicesProps, 'picked' | 'onPick'> {
	title: string;
	rows: PullRow[];
}

/** One group of pull requests to choose from; nothing when it holds none. */
function ChoiceGroup({ title, rows, picked, onPick }: ChoiceGroupProps) {
	if (rows.length === 0) return null;

	return (
		<ComposeGroup title={title} count={rows.length}>
			{rows.map((row) => (
				<RowButton
					key={row.key}
					data-choice
					data-current={isPicked(row, picked) || undefined}
					aria-pressed={isPicked(row, picked)}
					className="compose-row"
					onClick={() => onPick(row)}
				>
					<PullMark state={row.status.kind === 'draft' ? 'draft' : 'open'} />
					<span className="compose-row-text">
						<span className="compose-row-title">
							<span className="compose-row-name">{row.title}</span>
							<span className="pull-row-number">#{row.number}</span>
						</span>
						<PullMeta row={row} />
					</span>
					<StatusPill status={row.status} />
					<DiffStat additions={row.additions} deletions={row.deletions} />
					<span aria-hidden className="choice-mark" />
				</RowButton>
			))}
		</ComposeGroup>
	);
}

/** True when the row is the chosen pull request. */
function isPicked(row: PullRow, picked: PickTarget | null): boolean {
	return picked?.kind === 'pull' && picked.repoId === row.repoId && picked.number === row.number;
}
