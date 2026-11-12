'use client';

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@recoder/ui';
import { ChevronDown, Keyboard, Link2, Monitor, Moon, Settings, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ComponentType } from 'react';
import type { ThemeChoice } from '@recoder/shared';

import { useChrome } from '@/lib/shell/chrome';
import { settingsHref } from '@/lib/shell/routes';
import { useTheme } from '@/lib/shell/theme';

import { Avatar } from '@/components/common/avatar';

const THEMES: { choice: ThemeChoice; label: string; icon: ComponentType<{ className?: string }> }[] = [
	{ choice: 'light', label: 'Light', icon: Sun },
	{ choice: 'dark', label: 'Dark', icon: Moon },
	{ choice: 'system', label: 'Match the system', icon: Monitor }
];

/** The name the account row shows before a forge is signed in. */
const LOCAL_ACCOUNT = 'Recoder';

/** The account row and its menu: settings, connections, the theme and the shortcuts. */
export function AccountMenu({ account }: { account: string | null }) {
	const router = useRouter();
	const theme = useTheme((state) => state.choice);
	const setTheme = useTheme((state) => state.set);
	const setShortcutsOpen = useChrome((state) => state.setShortcutsOpen);
	const name = account ?? LOCAL_ACCOUNT;

	/** The menu hands back the chosen row's value as text; only a known theme is set. */
	function chooseTheme(value: string): void {
		const chosen = THEMES.find((entry) => entry.choice === value);

		if (chosen) setTheme(chosen.choice);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger>
				<button type="button" className="account">
					<Avatar name={name} shape="square" />
					<span className="account-name">{name}</span>
					<ChevronDown aria-hidden />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-[220px]">
				<DropdownMenuItem icon={<Settings />} shortcut="mod+," onSelect={() => router.push(settingsHref())}>
					Settings
				</DropdownMenuItem>
				<DropdownMenuItem icon={<Link2 />} onSelect={() => router.push(settingsHref('connections'))}>
					Connections
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
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
