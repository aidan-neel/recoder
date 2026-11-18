'use client';

import {
	Button,
	CommandDialog,
	CommandEmpty,
	CommandFooter,
	CommandInput,
	CommandItem,
	CommandList,
	ConfirmDialog,
	SkeletonBox,
	type CommandHint
} from '@recoder/ui';
import { CheckIcon, CaretDownIcon, GitBranchIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import { useApi } from '@/lib/api/client';
import { useBranchList, type BranchList } from '@/lib/update/use-branch-list';
import { useUpdate } from '@/lib/update/update-store';

import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';

const HINTS: CommandHint[] = [
	{ keys: ['ArrowUp', 'ArrowDown'], label: 'navigate' },
	{ keys: ['Enter'], label: 'switch' },
	{ keys: ['Escape'], label: 'close' }
];

/** Placeholder rows while the server fetches its branches. */
const LOADING_ROWS = [0, 1, 2, 3];

/**
 * Admin → Branch: the branch this git checkout runs, and a switch to any
 * other branch on its remote, so a feature branch can be tried on the real
 * server. The switch runs like an update, and the strip above follows it.
 * Hidden unless the server runs from a git checkout.
 */
export function BranchGroup() {
	const status = useUpdate((store) => store.status);
	const phase = useUpdate((store) => store.phase);

	if (status?.mode !== 'git') return null;

	return (
		<SettingsGroup title="Branch">
			<SettingsRow name="Running branch" detail="Switching restarts the server; running reviews pause and resume">
				<BranchPicker current={status.current.branch} busy={phase === 'applying' || phase === 'checking'} />
			</SettingsRow>
		</SettingsGroup>
	);
}

/** A quiet trigger naming the branch, opening a searchable list of the remote's; picking one asks before it switches. */
function BranchPicker({ current, busy }: { current: string | undefined; busy: boolean }) {
	const { update: api } = useApi();
	const [open, setOpen] = useState(false);
	const [picked, setPicked] = useState<string | null>(null);
	const { list, load } = useBranchList();
	const label = current ?? 'Detached HEAD';

	/** Opens the list and reads the remote's branches afresh. */
	function show(): void {
		setOpen(true);
		load();
	}

	/** Closes the list and asks about the branch, unless it is the one already running. */
	function pick(branch: string): void {
		setOpen(false);
		if (branch !== current) setPicked(branch);
	}

	return (
		<>
			<Button
				variant="quiet"
				className="branch-trigger"
				disabled={busy}
				aria-haspopup="dialog"
				aria-expanded={open}
				aria-label={`Running branch: ${label}`}
				title={label}
				onClick={show}
			>
				<GitBranchIcon aria-hidden />
				<span className="branch-trigger-name">{label}</span>
				<CaretDownIcon aria-hidden className="branch-trigger-chevron" />
			</Button>
			<CommandDialog open={open} onOpenChange={setOpen} label="Branch" className="branch-dialog" defaultValue={current}>
				<CommandInput placeholder="Search branches" />
				<CommandList>
					<BranchRows list={list} current={current} onPick={pick} onRetry={load} />
				</CommandList>
				<CommandFooter hints={HINTS} />
			</CommandDialog>
			<ConfirmDialog
				open={picked !== null}
				onOpenChange={(next) => !next && setPicked(null)}
				title={`Switch to ${picked ?? ''}?`}
				description="Running reviews pause while the server restarts on it, then resume."
				confirmLabel="Switch"
				onConfirm={async () => {
					if (picked) await useUpdate.getState().switchBranch(api, picked);
				}}
			/>
		</>
	);
}

/** The list's body: placeholder rows, why it could not load, or the branches with the running one checked. */
function BranchRows({
	list,
	current,
	onPick,
	onRetry
}: {
	list: BranchList;
	current?: string;
	onPick: (branch: string) => void;
	onRetry: () => void;
}) {
	if (list.view === 'loading') {
		return LOADING_ROWS.map((row) => (
			<div key={row} className="branch-row-skeleton" aria-hidden>
				<SkeletonBox />
			</div>
		));
	}

	if (list.view === 'failed') {
		return (
			<div className="branch-failed" role="alert">
				<span>{list.error}</span>
				<Button variant="outline" onClick={onRetry}>
					Retry
				</Button>
			</div>
		);
	}

	return (
		<>
			{list.branches.map((branch) => (
				<CommandItem
					key={branch}
					value={branch}
					onSelect={() => onPick(branch)}
					leading={<GitBranchIcon aria-hidden />}
					detail={branch === current ? <RunningMark /> : null}
					className="branch-row"
				>
					{branch}
				</CommandItem>
			))}
			<CommandEmpty>No branch matches</CommandEmpty>
		</>
	);
}

/** The check on the running branch, named for a screen reader. */
function RunningMark() {
	return (
		<>
			<CheckIcon aria-hidden className="branch-row-check" />
			<span className="sr-only">Running</span>
		</>
	);
}
