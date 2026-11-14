import { HoverList, RowButton, SkeletonRows } from '@recoder/ui';

import type { PickTarget } from '@/lib/compose/types';
import type { PullRow } from '@/lib/pulls/types';

import { PullMark } from '@/components/common/pull-mark';

interface SuggestionsProps {
	rows: PullRow[];
	loading: boolean;
	/** The pull request chosen, whose row is marked. */
	picked: PickTarget | null;
	onPick: (row: PullRow) => void;
}

/** Open pull requests with no review yet, so the usual next one is a click from being chosen. */
export function Suggestions({ rows, loading, picked, onPick }: SuggestionsProps) {
	if (!loading && rows.length === 0) return null;

	return (
		<section className="compose-suggestions" aria-label="Not reviewed yet">
			<h2 className="section-label">Not reviewed yet</h2>
			{loading ? (
				<SkeletonRows count={3} height={32} glyph lines={1} rowClassName="suggestion-row" />
			) : (
				<HoverList itemSelector="[data-suggestion]">
					{rows.map((row) => (
						<RowButton
							key={row.key}
							data-suggestion
							aria-pressed={isPicked(row, picked)}
							className="suggestion-row"
							onClick={() => onPick(row)}
						>
							<PullMark />
							<span className="suggestion-title">{row.title}</span>
							<span className="meta">
								{row.repoName} #{row.number}
							</span>
						</RowButton>
					))}
				</HoverList>
			)}
		</section>
	);
}

/** True when the row is the chosen pull request. */
function isPicked(row: PullRow, picked: PickTarget | null): boolean {
	return picked?.kind === 'pull' && picked.repoId === row.repoId && picked.number === row.number;
}
