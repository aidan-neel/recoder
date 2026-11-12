'use client';

import { Button, Input, Keycap, Select, Tooltip, type SelectOption } from '@recoder/ui';
import { RefreshCw, Search } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';

import type { RepoOption } from '@/lib/pulls/types';
import { useKeys } from '@/lib/shell/use-keys';

/** The select value that stands for every repository. */
const ALL_REPOS = 'all';

interface RepoScopeProps {
	repos: RepoOption[];
	repoId: string | null;
	onChange: (repoId: string | null) => void;
}

/** Which repository's pull requests show: all of them, or one. Hidden until there are two to choose between. */
export function RepoScope({ repos, repoId, onChange }: RepoScopeProps) {
	if (repos.length < 2) return <span className="crumbs">{repos[0]?.name ?? 'Pull requests'}</span>;

	const options: SelectOption[] = [
		{ value: ALL_REPOS, label: 'All repositories' },
		...repos.map((repo) => ({ value: repo.id, label: repo.name }))
	];

	return (
		<Select
			variant="quiet"
			aria-label="Repository"
			value={repoId ?? ALL_REPOS}
			onValueChange={(value) => onChange(value === ALL_REPOS ? null : value)}
			options={options}
		/>
	);
}

interface PullsFindProps {
	query: string;
	onQueryChange: (query: string) => void;
	/** Opens the pull request the text names, when it names one. */
	onSubmit: () => void;
}

/** The field in the bar: typing narrows the list, and Enter opens a pasted link. `/` focuses it. */
export function PullsFind({ query, onQueryChange, onSubmit }: PullsFindProps) {
	const field = useRef<HTMLInputElement | null>(null);

	useKeys({ '/': () => field.current?.focus() });

	/** Enter opens what the text names; Escape clears the text first, then leaves the field. */
	function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
		if (event.key === 'Enter') onSubmit();

		if (event.key === 'Escape' && query) {
			event.stopPropagation();
			onQueryChange('');
		}
	}

	return (
		<Input
			ref={field}
			className="pulls-find"
			type="search"
			aria-label="Filter pull requests, or paste a link"
			placeholder="Filter, or paste a pull request link"
			autoComplete="off"
			spellCheck={false}
			leading={<Search aria-hidden />}
			trailing={query ? undefined : <Keycap k="/" />}
			value={query}
			onChange={(event) => onQueryChange(event.target.value)}
			onKeyDown={onKeyDown}
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
				aria-label="Refresh"
				status={refreshing ? 'pending' : 'idle'}
				onClick={onRefresh}
			>
				<RefreshCw />
			</Button>
		</Tooltip>
	);
}
