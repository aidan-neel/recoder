'use client';

import type { ThemeChoice } from '@recoder/shared';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	ForgeMark,
	Pill
} from '@recoder/ui';
import { ChevronDown, Keyboard, LogOut, Monitor, Moon, Plus, Settings, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ComponentType } from 'react';

import { useAccountMenu, type AccountMenuView } from '@/lib/account/use-account-menu';
import { forgeLabel } from '@/lib/connections/forges';
import { useChrome } from '@/lib/shell/chrome';
import { settingsHref } from '@/lib/shell/routes';
import { useTheme } from '@/lib/shell/theme';

import { LinkForgeDialog } from '@/components/account/link-forge-dialog';
import { Avatar } from '@/components/common/avatar';

const THEMES: { choice: ThemeChoice; label: string; icon: ComponentType<{ className?: string }> }[] = [
	{ choice: 'light', label: 'Light', icon: Sun },
	{ choice: 'dark', label: 'Dark', icon: Moon },
	{ choice: 'system', label: 'Match the system', icon: Monitor }
];

/** The name the account row shows before a forge is signed in. */
const LOCAL_ACCOUNT = 'Recoder';

/** The name and role at the top of the menu; nothing without an account, which has no role. */
function RoleHead({ view }: { view: AccountMenuView }) {
	if (!view.role) return null;

	return (
		<>
			<div className="account-menu-head">
				<span className="account-menu-name">{view.name}</span>
				<Pill>{view.role === 'admin' ? 'Admin' : 'Member'}</Pill>
			</div>
			<DropdownMenuSeparator />
		</>
	);
}

/** The forges the account signs in with, each a row that opens Connections, and the ones it can still link. */
function ForgeRows({ view, onOpen }: { view: AccountMenuView; onOpen: () => void }) {
	if (view.forges.length === 0 && view.linkable.length === 0) return null;

	return (
		<>
			{view.forges.map((forge) => (
				<DropdownMenuItem
					key={`${forge.provider}:${forge.host ?? ''}`}
					icon={<ForgeMark provider={forge.provider} />}
					onSelect={onOpen}
				>
					{forge.login}
				</DropdownMenuItem>
			))}
			{view.linkable.map((provider) => (
				<DropdownMenuItem key={provider} icon={<Plus />} onSelect={() => view.link.begin(provider)}>
					Link {forgeLabel(provider)}
				</DropdownMenuItem>
			))}
			<DropdownMenuSeparator />
		</>
	);
}

/** The account row and its menu: the forges linked, settings, the shortcuts, the theme and sign out. */
export function AccountMenu({ account }: { account: string | null }) {
	const router = useRouter();
	const theme = useTheme((state) => state.choice);
	const setTheme = useTheme((state) => state.set);
	const setShortcutsOpen = useChrome((state) => state.setShortcutsOpen);
	const view = useAccountMenu(account ?? LOCAL_ACCOUNT);

	/** The menu hands back the chosen row's value as text; only a known theme is set. */
	function chooseTheme(value: string): void {
		const chosen = THEMES.find((entry) => entry.choice === value);

		if (chosen) setTheme(chosen.choice);
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger>
					<button type="button" className="account" data-swap-focus>
						<Avatar name={view.name} src={view.avatarUrl} shape="square" />
						<span className="account-name">{view.name}</span>
						<ChevronDown aria-hidden />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent className="w-[220px]">
					<RoleHead view={view} />
					<ForgeRows view={view} onOpen={() => router.push(settingsHref('connections'))} />
					<DropdownMenuItem icon={<Settings />} shortcut="mod+," onSelect={() => router.push(settingsHref())}>
						Settings
					</DropdownMenuItem>
					<DropdownMenuItem icon={<Keyboard />} shortcut="?" onSelect={() => setShortcutsOpen(true)}>
						Keyboard shortcuts
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuRadioGroup value={theme} onValueChange={chooseTheme}>
						{THEMES.map(({ choice, label, icon: Icon }) => (
							<DropdownMenuRadioItem
								key={choice}
								value={choice}
								icon={<Icon />}
								onSelect={(event) => event.preventDefault()}
							>
								{label}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
					{view.canSignOut ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem icon={<LogOut />} onSelect={view.signOut}>
								Sign out
							</DropdownMenuItem>
						</>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>
			<LinkForgeDialog link={view.link} />
		</>
	);
}
