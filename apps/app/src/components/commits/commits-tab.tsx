'use client';

import type { PullCommit } from '@recoder/shared';
import { Button, CopyButton, HoverList, RowButton, SkeletonRows, StatusNotice } from '@recoder/ui';

import { usePullCommitsView } from '@/lib/pull/pull-session';
import { author } from '@/lib/shell/format';

import { Age } from '@/components/common/age';
import { Avatar } from '@/components/common/avatar';

/** One commit: who, what, when; its hash copies. The row opens the commit on the forge when it has a page there. */
function CommitRow({ commit }: { commit: PullCommit }) {
	const by = author(commit.author.login);

	return (
		<li className="commit-row" data-commit>
			<Avatar name={by.name} src={commit.author.avatarUrl} />
			<div className="commit-row-text">
				{commit.url ? (
					<RowButton asChild cover className="commit-title">
						<a href={commit.url} target="_blank" rel="noreferrer" title={commit.body || undefined}>
							{commit.title}
						</a>
					</RowButton>
				) : (
					<span className="commit-title" title={commit.body || undefined}>
						{commit.title}
					</span>
				)}
				<span className="meta">
					{by.name}
					<Age at={commit.authoredAt} className="meta-sep" />
				</span>
			</div>
			<span className="commit-sha">
				<CopyButton
					variant="ghost"
					size="sm"
					value={commit.sha}
					label={<span className="mono">{commit.sha.slice(0, 7)}</span>}
					copiedLabel="Copied"
				/>
			</span>
		</li>
	);
}

/** The Commits tab: every commit of the pull request, oldest first. */
export function CommitsTab() {
	const commits = usePullCommitsView();

	return (
		<div className="reading">
			<div className="reading-column">
				{commits.phase === 'loading' ? <SkeletonRows count={6} height={52} glyph /> : null}
				{commits.phase === 'failed' ? (
					<div className="page-notice">
						<StatusNotice
							tone="danger"
							title="The commits did not load."
							detail={commits.error}
							actions={<Button onClick={commits.retry}>Try again</Button>}
						/>
					</div>
				) : null}
				{commits.phase === 'ready' && commits.value.length === 0 ? (
					<div className="page-notice">
						<StatusNotice title="This pull request has no commits." />
					</div>
				) : null}
				{commits.phase === 'ready' && commits.value.length > 0 ? (
					<HoverList as="ol" className="commit-list" itemSelector="[data-commit]">
						{commits.value.map((commit) => (
							<CommitRow key={commit.sha} commit={commit} />
						))}
					</HoverList>
				) : null}
			</div>
		</div>
	);
}
