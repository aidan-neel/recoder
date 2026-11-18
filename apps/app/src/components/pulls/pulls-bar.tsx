'use client';

import { Button, Select, Tooltip, type SelectOption } from '@recoder/ui';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react';

import type { RepoOption } from '@/lib/pulls/types';

import { RepoLabel } from '@/components/common/repo-label';

/** The select value that stands for every repository. */
const ALL_REPOS = 'all';

interface RepoScopeProps {
	repos: RepoOption[];
	repoId: string | null;
	onChange: (repoId: string | null) => void;
}

/** Which repository's pull requests show: all of them, or one. Hidden until there are two to choose between. */
export function RepoScope({ repos, repoId, onChange }: RepoScopeProps) {
	const [only] = repos;

	if (repos.length < 2) {
		return (
			<span className="crumbs">{only ? <RepoLabel name={only.name} forge={only.provider} /> : 'Pull requests'}</span>
		);
	}

	const options: SelectOption[] = [
		{ value: ALL_REPOS, label: 'All repositories' },
		...repos.map((repo) => ({ value: repo.id, label: <RepoLabel name={repo.name} forge={repo.provider} /> }))
	];

	return (
		<Select
			variant="quiet"
			className="pulls-scope"
			aria-label="Repository"
			value={repoId ?? ALL_REPOS}
			onValueChange={(value) => onChange(value === ALL_REPOS ? null : value)}
			options={options}
		/>
	);
}

/** Reads the list again now. The icon turns while it does. */
export function RefreshButton({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) {
	return (
		<Tooltip content="Refresh">
			<Button
				variant="ghost"
				size="icon"
				className="pulls-refresh"
				aria-label="Refresh"
				status={refreshing ? 'pending' : 'idle'}
				onClick={onRefresh}
			>
				<ArrowsClockwiseIcon />
			</Button>
		</Tooltip>
	);
}
