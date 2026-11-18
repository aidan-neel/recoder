'use client';

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	ForgeMark,
	Pill
} from '@recoder/ui';
import { CaretDownIcon, KeyboardIcon, SignOutIcon, PlusIcon, GearIcon } from '@phosphor-icons/react';

import { useAccountMenu, type AccountMenuView } from '@/lib/account/use-account-menu';
import { forgeLabel } from '@/lib/connections/forges';
import { useApi } from '@/lib/api/client';
import { useChrome } from '@/lib/shell/chrome';
import { isLiveApp } from '@/lib/shell/routes';

import { LinkForgeDialog } from '@/components/account/link-forge-dialog';
import { Avatar } from '@/components/common/avatar';

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
				<DropdownMenuItem key={provider} icon={<PlusIcon />} onSelect={() => view.link.begin(provider)}>
					Link {forgeLabel(provider)}
				</DropdownMenuItem>
			))}
			<DropdownMenuSeparator />
		</>
	);
}

/**
 * The account row and its menu: the forges linked, settings, the shortcuts and sign out. The sample's menu keeps
 * only what it has: no forges to link and no settings to open.
 */
export function AccountMenu({ account }: { account: string | null }) {
	const setShortcutsOpen = useChrome((state) => state.setShortcutsOpen);
	const openSettings = useChrome((state) => state.openSettings);
	const view = useAccountMenu(account ?? LOCAL_ACCOUNT);
	const live = isLiveApp(useApi().base);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger>
					<button type="button" className="account">
						<Avatar name={view.name} src={view.avatarUrl} shape="square" />
						<span className="account-name">{view.name}</span>
						<CaretDownIcon aria-hidden />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent className="w-[220px]">
					<RoleHead view={view} />
					{live ? (
						<>
							<ForgeRows view={view} onOpen={() => openSettings('connections')} />
							<DropdownMenuItem icon={<GearIcon />} shortcut="mod+," onSelect={() => openSettings()}>
								Settings
							</DropdownMenuItem>
						</>
					) : null}
					<DropdownMenuItem icon={<KeyboardIcon />} shortcut="?" onSelect={() => setShortcutsOpen(true)}>
						Keyboard shortcuts
					</DropdownMenuItem>
					{view.canSignOut ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem icon={<SignOutIcon />} onSelect={view.signOut}>
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
