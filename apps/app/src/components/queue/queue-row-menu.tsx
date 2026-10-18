'use client';

import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@recoder/ui';
import { Fragment } from 'react';

import type { RowAction } from './row-actions';

/** The row's right-click menu: its actions, a hairline between groups. */
export function QueueRowMenu({ actions }: { actions: RowAction[] }) {
	return (
		<ContextMenuContent className="min-w-[13rem]">
			{actions.map((action, index) => {
				const Icon = action.icon;

				return (
					<Fragment key={action.id}>
						{index > 0 && actions[index - 1].group !== action.group ? <ContextMenuSeparator /> : null}
						<ContextMenuItem
							icon={<Icon />}
							shortcut={action.shortcut}
							destructive={action.destructive}
							disabled={action.disabled}
							onSelect={action.run}
						>
							{action.label}
						</ContextMenuItem>
					</Fragment>
				);
			})}
		</ContextMenuContent>
	);
}
