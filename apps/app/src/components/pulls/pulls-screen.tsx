'use client';

import { Button, SkeletonRows } from '@recoder/ui';
import { CornerDownLeft, Info, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';

import type { PullListView, PullRow, PullTarget } from '@/lib/pulls/types';
import { useOpenPull } from '@/lib/pulls/use-open-pull';
import { usePullList } from '@/lib/pulls/use-pull-list';
import { errorToast } from '@/lib/shell/notify';
import { useAction } from '@/lib/shell/use-action';

import { Age } from '@/components/common/age';
import { Page } from '@/components/common/page';

import { PullFilterMenu } from './pull-filter';
import { PullList } from './pull-list';
import { PullsFind, RefreshButton, RepoScope } from './pulls-bar';
import { PullsNotice } from './pulls-notice';

/** How many placeholder rows stand in while the list loads for the first time. */
const LOADING_ROWS = 6;

/** A sentence for a rejection: its own message, else a plain fallback. */
function reason(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

/** What Enter does for the text in the field, when it names a pull request. */
function openLabel(target: PullTarget): string | null {
	if (target.kind === 'pull') return `Open ${target.repoName} #${target.number}`;
	if (target.kind === 'untracked') return `Connect ${target.repoName} and open #${target.number}`;

	return null;
}

/**
 * What the list does not show in full: repositories whose forge did not
 * answer, and ones with more open pull requests than the list holds. The rest
 * of the list still shows.
 */
function Strips({ failures, truncated }: Pick<PullListView, 'failures' | 'truncated'>) {
	if (failures.length === 0 && truncated.length === 0) return null;

	return (
		<div className="pulls-strips">
			{failures.map((failure) => (
				<div key={failure.repoName} className="strip" role="status">
					<TriangleAlert aria-hidden />
					<span className="strip-text">
						<strong>{failure.repoName}</strong> did not load. {failure.error}
					</span>
				</div>
			))}
			{truncated.map((repo) => (
				<div key={repo.repoId} className="strip" data-tone="neutral" role="status">
					<Info aria-hidden />
					<span className="strip-text">
						<strong>{repo.repoName}</strong> has more open pull requests than fit here. Paste a link to open an older
						one.
					</span>
				</div>
			))}
		</div>
	);
}

interface OpenRowProps {
	label: string;
	onOpen: () => void;
	status: ReturnType<typeof useAction>['status'];
}

/** Offers to open the pull request the pasted text names. */
function OpenRow({ label, onOpen, status }: OpenRowProps) {
	return (
		<div className="pulls-open">
			<CornerDownLeft aria-hidden className="size-4 text-fg-faint" />
			<span className="pulls-open-text">{label}</span>
			<Button variant="primary" status={status} onClick={onOpen}>
				Open
			</Button>
		</div>
	);
}

/**
 * The pull request list: every open pull request of the connected
 * repositories, newest activity first, each with the one fact that needs
 * attention. The field narrows the list and opens a pasted link.
 */
export function PullsScreen() {
	const router = useRouter();
	const view = usePullList();
	const opener = useOpenPull();
	const opening = useAction();
	const target = opener.resolve(view.query);
	const pasted = openLabel(target);
	const loading = view.phase === 'loading';

	/** Starts a review from a row; a refusal shows as a toast and the row goes back by itself. */
	function review(row: PullRow): void {
		view.review(row).catch((error: unknown) => errorToast(reason(error, 'The review did not start.')));
	}

	/** Opens the pull request the field's text names, connecting its repository first when it must. */
	function openPasted(): void {
		if (!pasted) return;

		opening.run(() =>
			opener.open(view.query).then(
				(href) => {
					view.setQuery('');
					router.push(href);
				},
				(error: unknown) => {
					errorToast(reason(error, 'That pull request did not open.'));
					throw error;
				}
			)
		);
	}

	return (
		<Page
			start={<RepoScope repos={view.repos} repoId={view.repoId} onChange={view.setRepoId} />}
			end={
				<>
					<PullsFind query={view.query} onQueryChange={view.setQuery} onSubmit={openPasted} />
					<RefreshButton refreshing={view.refreshing} onRefresh={view.refresh} />
				</>
			}
		>
			<div className="page-scroll">
				<div className="page-column">
					<Strips failures={view.failures} truncated={view.truncated} />
					<div className="pulls-head">
						<h1 className="contents">
							<PullFilterMenu filter={view.filter} counts={view.counts} onChange={view.setFilter} />
						</h1>
						{view.fetchedAt ? (
							<span className="meta pulls-updated">
								Updated <Age at={view.fetchedAt} form="long" />
							</span>
						) : null}
					</div>
					{loading ? <SkeletonRows count={LOADING_ROWS} height={60} glyph className="pull-list-skeleton" /> : null}
					{!loading && view.rows.length > 0 ? (
						<PullList rows={view.rows} starting={view.starting} onReview={review} />
					) : null}
					{!loading && view.rows.length === 0 && pasted ? (
						<OpenRow label={pasted} onOpen={openPasted} status={opening.status} />
					) : null}
					{!loading && view.rows.length === 0 && !pasted ? (
						<div className="page-notice">
							<PullsNotice view={view} />
						</div>
					) : null}
				</div>
			</div>
		</Page>
	);
}
