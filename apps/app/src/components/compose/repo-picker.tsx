'use client';

import {
	Button,
	CommandDialog,
	CommandEmpty,
	CommandFooter,
	CommandInput,
	CommandItem,
	CommandList,
	ForgeMark,
	type CommandHint
} from '@recoder/ui';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { useState } from 'react';

import type { ComposeRepo } from '@/lib/compose/types';
import { repoName } from '@/lib/shell/format';

const HINTS: CommandHint[] = [
	{ keys: ['ArrowUp', 'ArrowDown'], label: 'navigate' },
	{ keys: ['Enter'], label: 'choose' },
	{ keys: ['Escape'], label: 'close' }
];

interface RepoPickerProps {
	repos: ComposeRepo[];
	/** The repository a number or a branch is looked up in. */
	repoId: string | null;
	onPick: (repoId: string) => void;
	/** Opens the dialog that adds a repository. */
	onAdd: () => void;
}

/**
 * The repository a number or a branch is looked up in, compact in the
 * composer's bar: a quiet trigger with the forge's mark and the repository's
 * short name, opening a searchable dialog of every tracked repository, with
 * the current one checked and a row to add another. With none tracked, the
 * trigger adds one.
 */
export function RepoPicker({ repos, repoId, onPick, onAdd }: RepoPickerProps) {
	const [open, setOpen] = useState(false);
	const current = repos.find((repo) => repo.id === repoId);

	/** Picks the repository and closes the dialog. */
	function pick(id: string): void {
		onPick(id);
		setOpen(false);
	}

	/** Closes this dialog for the one that adds a repository. */
	function add(): void {
		setOpen(false);
		onAdd();
	}

	if (!current) {
		return (
			<Button variant="quiet" className="bar-trigger" onClick={onAdd}>
				<Plus aria-hidden className="bar-trigger-add" />
				Add repository
			</Button>
		);
	}

	return (
		<>
			<Button
				variant="quiet"
				className="bar-trigger"
				aria-haspopup="dialog"
				aria-expanded={open}
				aria-label={`Repository: ${current.name}`}
				title={current.name}
				onClick={() => setOpen(true)}
			>
				<ForgeMark provider={current.provider} />
				<span className="bar-trigger-name">{repoName(current.name)}</span>
				<ChevronDown aria-hidden className="bar-trigger-chevron" />
			</Button>
			<CommandDialog
				open={open}
				onOpenChange={setOpen}
				label="Repository"
				className="repo-dialog"
				defaultValue={current.name}
			>
				<CommandInput placeholder="Search repositories" />
				<CommandList>
					{repos.map((repo) => (
						<CommandItem
							key={repo.id}
							value={repo.name}
							keywords={[repo.id]}
							onSelect={() => pick(repo.id)}
							leading={<ForgeMark provider={repo.provider} />}
							detail={repo.id === current.id ? <CurrentMark /> : null}
							className="repo-row"
						>
							{repo.name}
						</CommandItem>
					))}
					<CommandItem
						value="Add repository"
						onSelect={add}
						leading={<Plus aria-hidden />}
						className="repo-row repo-row-add"
					>
						Add repository
					</CommandItem>
					<CommandEmpty>No repository matches</CommandEmpty>
				</CommandList>
				<CommandFooter hints={HINTS} />
			</CommandDialog>
		</>
	);
}

/** The check on the current repository, named for a screen reader. */
function CurrentMark() {
	return (
		<>
			<Check aria-hidden className="repo-row-check" />
			<span className="sr-only">Current repository</span>
		</>
	);
}
