'use client';

import {
	CommandDialog,
	CommandEmpty,
	CommandFooter,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	type CommandHint
} from '@recoder/ui';
import {
	BookOpenIcon,
	ClockIcon,
	ArrowElbowDownLeftIcon,
	FolderSimpleIcon,
	GitPullRequestIcon,
	KeyboardIcon,
	PaletteIcon,
	PlusIcon,
	GearIcon,
	UserGearIcon,
	CircleHalfIcon
} from '@phosphor-icons/react';
import { useState, type ComponentType } from 'react';

import { useIsAdmin } from '@/lib/account/use-is-admin';
import { useApi } from '@/lib/api/client';
import type { PullRow, PullTarget } from '@/lib/pulls/types';
import { useOpenPull } from '@/lib/pulls/use-open-pull';
import { useRowEntries } from '@/lib/pulls/use-rows';
import { useChrome } from '@/lib/shell/chrome';
import { navigate } from '@/lib/shell/navigation';
import { errorToast } from '@/lib/shell/notify';
import { AUTOMATIONS_HREF, GUIDELINES_HREF, isLiveApp, newReviewHref, pullsHref, reposHref } from '@/lib/shell/routes';
import { useTheme } from '@/lib/shell/theme';

import { PullMark } from '@/components/common/pull-mark';

const HINTS: CommandHint[] = [
	{ keys: ['ArrowUp', 'ArrowDown'], label: 'navigate' },
	{ keys: ['Enter'], label: 'open' },
	{ keys: ['Escape'], label: 'close' }
];

/** The most pull requests the palette lists before the person types. */
const RESTING_PULLS = 6;

interface Action {
	id: string;
	label: string;
	icon: ComponentType<{ className?: string }>;
	shortcut?: string;
	run: () => void;
}

/** What the pasted-link row says for a target the palette can open. */
function targetLabel(target: PullTarget): string | null {
	if (target.kind === 'pull') return `Open ${target.repoName} #${target.number}`;
	if (target.kind === 'untracked') return `Track ${target.repoName} and open #${target.number}`;

	return null;
}

/** One open pull request: its title, then where it is. */
function PullItem({ row, onOpen }: { row: PullRow; onOpen: (href: string) => void }) {
	return (
		<CommandItem
			value={row.key}
			keywords={[row.title, row.repoName, String(row.number), row.author]}
			leading={<PullMark state={row.status.kind === 'draft' ? 'draft' : 'open'} />}
			detail={`${row.repoName} #${row.number}`}
			onSelect={() => onOpen(row.href)}
		>
			{row.title}
		</CommandItem>
	);
}

/**
 * Search from anywhere: a pasted pull request link opens (tracking its
 * repository first when it must), the open pull requests are one word away,
 * and so are the places and the theme.
 */
export function CommandPalette() {
	const { base } = useApi();
	const open = useChrome((state) => state.paletteOpen);
	const setOpen = useChrome((state) => state.setPaletteOpen);
	const setShortcutsOpen = useChrome((state) => state.setShortcutsOpen);
	const openSettings = useChrome((state) => state.openSettings);
	const toggleTheme = useTheme((state) => state.toggle);
	const admin = useIsAdmin();
	const entries = useRowEntries();
	const opener = useOpenPull();
	const [query, setQuery] = useState('');
	const target = opener.resolve(query);
	const pasted = targetLabel(target);
	const pulls = query ? entries : entries.slice(0, RESTING_PULLS);

	/** Leaves the palette for a page. */
	function go(href: string): void {
		setOpen(false);
		navigate(href);
	}

	/** Opens the pull request the text names; a refusal stays on screen as a toast. */
	function openPasted(): void {
		setOpen(false);

		opener
			.open(query)
			.then(navigate, (error: unknown) =>
				errorToast(error instanceof Error ? error.message : 'That pull request did not open.')
			);
	}

	/** The live app's own pages and its Settings; the sample has none of them, so its palette leaves them out. */
	const livePlaces: Action[] = [
		{ id: 'automations', label: 'Automations', icon: ClockIcon, run: () => go(AUTOMATIONS_HREF) },
		{ id: 'guidelines', label: 'Guidelines', icon: BookOpenIcon, run: () => go(GUIDELINES_HREF) },
		...(admin ? [{ id: 'admin', label: 'Recoder', icon: UserGearIcon, run: () => openSettings('admin') }] : []),
		{ id: 'settings', label: 'Settings', icon: GearIcon, shortcut: 'mod+,', run: () => openSettings() },
		{ id: 'palette', label: 'Change palette', icon: PaletteIcon, run: () => openSettings('appearance') }
	];

	const actions: Action[] = [
		{ id: 'new', label: 'New review', icon: PlusIcon, shortcut: 'c', run: () => go(newReviewHref(base)) },
		{ id: 'pulls', label: 'Pull requests', icon: GitPullRequestIcon, run: () => go(pullsHref(base)) },
		{ id: 'repos', label: 'Repositories', icon: FolderSimpleIcon, run: () => go(reposHref(base)) },
		...(isLiveApp(base) ? livePlaces : []),
		{ id: 'theme', label: 'Switch theme', icon: CircleHalfIcon, run: toggleTheme },
		{
			id: 'shortcuts',
			label: 'Keyboard shortcuts',
			icon: KeyboardIcon,
			shortcut: '?',
			run: () => setShortcutsOpen(true)
		}
	];

	return (
		<CommandDialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) setQuery('');
			}}
			label="Search Recoder"
		>
			<CommandInput placeholder="Search pull requests, or paste a link" value={query} onValueChange={setQuery} />
			<CommandList>
				<CommandEmpty>Nothing matches. Paste a pull request link to open it.</CommandEmpty>
				{pasted ? (
					<CommandGroup>
						<CommandItem value={query} icon={ArrowElbowDownLeftIcon} onSelect={openPasted}>
							{pasted}
						</CommandItem>
					</CommandGroup>
				) : null}
				{pulls.length > 0 ? (
					<CommandGroup heading="Pull requests">
						{pulls.map(({ row }) => (
							<PullItem key={row.key} row={row} onOpen={go} />
						))}
					</CommandGroup>
				) : null}
				<CommandGroup heading="Go to">
					{actions.map(({ id, label, icon, shortcut, run }) => (
						<CommandItem key={id} value={`go ${label}`} icon={icon} shortcut={shortcut} onSelect={run}>
							{label}
						</CommandItem>
					))}
				</CommandGroup>
			</CommandList>
			<CommandFooter hints={HINTS} />
		</CommandDialog>
	);
}
