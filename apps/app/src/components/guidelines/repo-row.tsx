'use client';

import type { GuidelinesOverview } from '@recoder/shared';
import { Button, Skeleton, SkeletonText } from '@recoder/ui';

import { useRepoRow, type RepoRowError } from '@/lib/guidelines/use-repo-row';

import { GuidelinesRow } from './guidelines-row';
import { LayerRow } from './layer-row';
import { RepoStatus } from './repo-status';

interface RepoRowProps {
	repo: GuidelinesOverview['repos'][number];
	overview: GuidelinesOverview;
}

/** The summary's line height, so the bar that stands in for it takes the same room. */
const SUMMARY_LINE_HEIGHT = 18;

/** Summary bar widths, picked by repository so loading rows do not look stamped. */
const SUMMARY_WIDTHS = ['44%', '36%', '52%'] as const;

/** The summary bar's width for one repository: the same one on every load. */
function summaryWidth(id: string): string {
	const sum = [...id].reduce((total, char) => total + char.charCodeAt(0), 0);

	return SUMMARY_WIDTHS[sum % SUMMARY_WIDTHS.length];
}

/** The file is still being read through the forge: the name, with bars where the summary and the button land. */
function LoadingRow({ id, name }: { id: string; name: string }) {
	return (
		<GuidelinesRow
			name={name}
			summary={<SkeletonText count={1} widths={[summaryWidth(id)]} lineHeight={SUMMARY_LINE_HEIGHT} />}
			open={false}
			action={<Skeleton className="guidelines-action-skeleton" />}
		/>
	);
}

/** A read that failed (the forge said no, or the server is down): the reason, and a retry. */
function FailedRow({ view }: { view: RepoRowError }) {
	return (
		<GuidelinesRow
			name={view.name}
			failure={view.summary}
			open={false}
			action={
				<Button variant="outline" status={view.retry.status} onClick={view.retry.run}>
					Try again
				</Button>
			}
		/>
	);
}

/**
 * One tracked repository and its guidelines file: its first rule, where the
 * file stands, and Edit or Write. Saving opens a pull request; the file
 * applies once it merges.
 */
export function RepoRow({ repo, overview }: RepoRowProps) {
	const view = useRepoRow(repo, overview);

	if (view.kind === 'error') return <FailedRow view={view} />;
	if (view.kind === 'loading') return <LoadingRow id={repo.id} name={view.name} />;

	return <LayerRow name={view.name} status={<RepoStatus data={view.data} />} view={view} />;
}
