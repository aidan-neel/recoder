'use client';

import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger
} from '@recoder/ui';
import { Fragment, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';

import type { QueueEntry, QueueSection } from '@/lib/queue/queue';
import { useQueue } from '@/lib/queue/queue-store';

import { rowActions, type RowAction } from './row-actions';

/** The row's right-click menu: its actions, a hairline between groups. */
function QueueRowMenu({ actions }: { actions: RowAction[] }) {
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

interface MenuHandlers {
	sample: boolean;
	href: (entry: QueueEntry) => string | null;
	onOpen: (entry: QueueEntry) => void;
	onStart: (entry: QueueEntry) => void;
	onDelete: (entry: QueueEntry) => void;
}

/** The menu for one row, which follows the row's pending start while it is open. */
function EntryMenu({ entry, sample, href, onOpen, onStart, onDelete }: MenuHandlers & { entry: QueueEntry }) {
	const starting = useQueue((state) => !!state.starting[entry.key]);

	return (
		<QueueRowMenu actions={rowActions(entry, { href: href(entry), sample, starting, onOpen, onStart, onDelete })} />
	);
}

/** The key of the row an event happened in, or null outside every row. */
function rowKey(target: EventTarget | null): string | null {
	return target instanceof Element
		? (target.closest('[data-queue-key]')?.getAttribute('data-queue-key') ?? null)
		: null;
}

function entryOf(sections: QueueSection[], key: string): QueueEntry | null {
	for (const section of sections) {
		const entry = section.entries.find((item) => item.key === key);

		if (entry) return entry;
	}

	return null;
}

/**
 * One right-click menu for every row of the list: a right click (or the
 * context-menu key, or a long press) on a row opens that row's actions at the
 * pointer. One menu for the list, instead of one per row, keeps a long queue
 * from setting up a menu root, trigger and key listener for each row as it
 * paints. A right click between rows opens nothing. The last row's menu stays
 * built after it closes, so it can fade out.
 */
export function QueueListMenu({
	sections,
	children,
	...handlers
}: MenuHandlers & { sections: QueueSection[]; children: ReactNode }) {
	const [key, setKey] = useState<string | null>(null);
	const entry = key === null ? null : entryOf(sections, key);

	const onContextMenu = (event: MouseEvent) => {
		const next = rowKey(event.target);

		if (next === null) return event.preventDefault();

		setKey(next);
	};

	const onPointerDown = (event: PointerEvent) => {
		if (event.pointerType !== 'mouse') setKey(rowKey(event.target));
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger>
				<div className="contents" onContextMenu={onContextMenu} onPointerDown={onPointerDown}>
					{children}
				</div>
			</ContextMenuTrigger>
			{entry ? <EntryMenu entry={entry} {...handlers} /> : null}
		</ContextMenu>
	);
}
