'use client';

import {
	Button,
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	RowButton
} from '@recoder/ui';
import { Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { Fragment, type ComponentType, type ReactNode } from 'react';

import { useIntent } from '@/lib/shell/intent';

import type { RowAction } from './recent-actions';

interface RecentRowProps {
	href: string;
	active: boolean;
	/** A 16px mark before the text: a review's state, or a chat's icon. */
	mark: ReactNode;
	title: string;
	/** The line under the title, in the meta face. Without it the row is one line. */
	meta?: ReactNode;
	/** Quiet text at the row's right edge, such as an age; it steps aside for the "more" button. */
	trailing?: ReactNode;
	/** The row's menu, shown on right click and behind the "more" button. */
	actions: RowAction[];
	/** Runs once the pointer or focus has rested on the row: prefetching its page. */
	onIntent?: () => void;
}

interface MenuParts {
	Item: typeof DropdownMenuItem | typeof ContextMenuItem;
	Separator: ComponentType;
}

/** The entries of one menu; the two menus differ only in the parts they are built from. */
function ActionItems({ actions, parts: { Item, Separator } }: { actions: RowAction[]; parts: MenuParts }) {
	return actions.map(({ id, label, icon: Icon, destructive, separated, onSelect }) => (
		<Fragment key={id}>
			{separated ? <Separator /> : null}
			<Item icon={<Icon />} destructive={destructive} onSelect={onSelect}>
				{label}
			</Item>
		</Fragment>
	));
}

const DROPDOWN_PARTS: MenuParts = { Item: DropdownMenuItem, Separator: DropdownMenuSeparator };
const CONTEXT_PARTS: MenuParts = { Item: ContextMenuItem, Separator: ContextMenuSeparator };

/** The intent a row without one rests on. */
function noop(): void {}

/**
 * One row of the sidebar's recent lists: a mark, then a title, over a meta
 * line when there is one. A right click opens its menu at the pointer; the "more" button,
 * which shows on hover and focus, opens the same entries beside the row.
 */
export function RecentRow({ href, active, mark, title, meta, trailing, actions, onIntent }: RecentRowProps) {
	const intent = useIntent(onIntent ?? noop);

	return (
		<ContextMenu>
			<ContextMenuTrigger>
				<div className="recent-entry" data-recent {...intent}>
					<RowButton
						asChild
						data-active={active || undefined}
						data-single={meta ? undefined : true}
						className="recent-item"
					>
						<Link href={href} aria-current={active ? 'page' : undefined}>
							{mark}
							<span className="recent-text">
								<span className="recent-title">{title}</span>
								{meta ? <span className="meta">{meta}</span> : null}
							</span>
							{trailing}
						</Link>
					</RowButton>
					<DropdownMenu>
						<DropdownMenuTrigger>
							<Button variant="ghost" size="icon" className="recent-more" aria-label={`More for ${title}`}>
								<Ellipsis />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="w-[200px]">
							<ActionItems actions={actions} parts={DROPDOWN_PARTS} />
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent className="w-[200px]">
				<ActionItems actions={actions} parts={CONTEXT_PARTS} />
			</ContextMenuContent>
		</ContextMenu>
	);
}
