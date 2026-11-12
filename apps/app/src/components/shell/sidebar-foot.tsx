'use client';

import { Button, Tooltip } from '@recoder/ui';
import { CircleHelp, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';

import { useChrome } from '@/lib/shell/chrome';
import { useTheme } from '@/lib/shell/theme';

/** The foot of the sidebar: the model reviews run with, the shortcuts and the theme. */
export function SidebarFoot({ model }: { model: ReactNode }) {
	const toggleTheme = useTheme((state) => state.toggle);
	const setShortcutsOpen = useChrome((state) => state.setShortcutsOpen);

	return (
		<div className="sidebar-foot">
			{model}
			<Tooltip content="Keyboard shortcuts" shortcut="?">
				<Button variant="ghost" size="icon" aria-label="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}>
					<CircleHelp />
				</Button>
			</Tooltip>
			<Tooltip content="Switch theme">
				<Button variant="ghost" size="icon" aria-label="Switch theme" onClick={toggleTheme}>
					<Sun className="hidden dark:block" />
					<Moon className="dark:hidden" />
				</Button>
			</Tooltip>
		</div>
	);
}
