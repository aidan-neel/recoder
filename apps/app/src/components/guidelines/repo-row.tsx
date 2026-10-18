'use client';

import type { GuidelinesOverview, RepoGuidelines } from '@recoder/shared';
import { Button, cn, Skeleton } from '@recoder/ui';

import { useAction } from '@/lib/shell/use-action';
import { editLayer, useGuidelinesEditor, type ScopeKey } from '@/lib/guidelines/editor-store';
import { useGuidelines } from '@/lib/guidelines/guidelines-store';
import { firstRule, seedText } from '@/lib/guidelines/rules';

import { GuidelinesEditor } from './guidelines-editor';
import { GuidelinesRow } from './guidelines-row';
import { RepoStatus } from './repo-status';

type TrackedRepo = GuidelinesOverview['repos'][number];

interface RepoRowProps {
	repo: TrackedRepo;
	overview: GuidelinesOverview;
}

/** The row's line: the first rule in force (or pending), or that the file is missing. */
function repoSummary(data: RepoGuidelines): string {
	return firstRule(data.pending?.content ?? data.content) ?? `No ${data.path} yet`;
}

/** Placeholder widths, picked by repository so loading rows don't read as copies. */
const SKELETON_WIDTHS = ['w-[44%]', 'w-[36%]', 'w-[52%]'];

function skeletonWidth(id: string): string {
	const sum = [...id].reduce((total, char) => total + char.charCodeAt(0), 0);

	return SKELETON_WIDTHS[sum % SKELETON_WIDTHS.length];
}

/** A read that failed (the forge said no, or the server is down): the reason, and a retry. */
function FailedRow({ repo, error }: { repo: TrackedRepo; error: string }) {
	const retry = useAction();

	return (
		<GuidelinesRow
			name={repo.name}
			summary={error}
			failed
			open={false}
			action={
				<Button
					variant="outline"
					status={retry.status}
					onClick={() => retry.run(() => useGuidelines.getState().loadRepo(repo.id))}
				>
					Try again
				</Button>
			}
		/>
	);
}

/**
 * One tracked repository and its `.recoder/REVIEW.md`: the first rule, the
 * file's state (active on the default branch, pending in a pull request),
 * and Write or Edit. Saving opens a pull request; the file applies once it
 * merges.
 */
export function RepoRow({ repo, overview }: RepoRowProps) {
	const state = useGuidelines((store) => store.repos[repo.id]);
	const key: ScopeKey = `repo:${repo.id}`;
	const open = useGuidelinesEditor((store) => store.open === key);
	const opened = useGuidelinesEditor((store) => store.sessions[key]?.opened);

	if (state?.status === 'error') return <FailedRow repo={repo} error={state.error} />;

	if (state?.status !== 'ready') {
		return (
			<GuidelinesRow
				key="loading"
				name={repo.name}
				summary={<Skeleton className={cn('my-[3px] h-2.5', skeletonWidth(repo.id))} />}
				open={false}
				action={<Skeleton className="h-[26px] w-[52px] rounded-[8px]" />}
			/>
		);
	}

	const { data } = state;
	const written = data.content !== null || data.pending !== null;

	return (
		<GuidelinesRow
			key="ready"
			name={repo.name}
			summary={repoSummary(data)}
			status={<RepoStatus data={data} />}
			open={open}
			action={
				<Button
					variant="outline"
					onClick={() => editLayer(key, seedText(data.pending?.content ?? data.content, overview.template))}
				>
					{written ? 'Edit' : 'Write'}
				</Button>
			}
		>
			{opened === undefined ? null : (
				<GuidelinesEditor
					key={opened}
					scope={key}
					open={open}
					repo={data}
					maxChars={overview.maxChars}
					label={`${repo.name} guidelines`}
				/>
			)}
		</GuidelinesRow>
	);
}
