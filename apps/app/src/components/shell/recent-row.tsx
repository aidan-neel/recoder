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
import { CheckIcon, DotsThreeIcon } from '@phosphor-icons/react';
import { Fragment, type ComponentType, type ReactNode } from 'react';

import { useIntent } from '@/lib/shell/intent';

import { Link } from '@/components/common/link';

import type { RowAction } from './recent-actions';

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

/** How often the ages on the rows move on, in ms. */
export const AGE_TICK = 60_000;

interface RowShellProps {
	title: string;
	actions: RowAction[];
	/** Runs once the pointer or focus has rested on the row: prefetching its page. */
	onIntent?: () => void;
	className: string;
	active: boolean;
	/** Controls beside the "more" button, shown with it. */
	tools?: ReactNode;
	children: ReactNode;
}

/**
 * What every recent row shares: a right click opens its menu at the pointer,
 * and the "more" button, which shows on hover and focus, opens the same
 * entries beside the row. A row with no actions has neither.
 */
function RowShell({ title, actions, onIntent, className, active, tools, children }: RowShellProps) {
	const intent = useIntent(onIntent);

	if (actions.length === 0)
		return (
			<div className={className} data-recent data-active={active || undefined} {...intent}>
				{children}
			</div>
		);

	return (
		<ContextMenu>
			<ContextMenuTrigger>
				<div className={className} data-recent data-active={active || undefined} {...intent}>
					{children}
					<div className="recent-tools" skullet-ignore="">
						{tools}
						<DropdownMenu>
							<DropdownMenuTrigger>
								<Button variant="ghost" size="icon" className="recent-more" aria-label={`More for ${title}`}>
									<DotsThreeIcon />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start" className="w-[200px]">
								<ActionItems actions={actions} parts={DROPDOWN_PARTS} />
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent className="w-[200px]">
				<ActionItems actions={actions} parts={CONTEXT_PARTS} />
			</ContextMenuContent>
		</ContextMenu>
	);
}

interface RecentRowProps {
	href: string;
	active: boolean;
	/** A 16px mark before the title. */
	mark: ReactNode;
	title: string;
	/** Quiet text at the row's right edge, such as an age; it steps aside for the "more" button. */
	trailing?: ReactNode;
	actions: RowAction[];
	onIntent?: () => void;
}

/** One line of Settled: a mark, the title, and its age at the right. */
export function RecentRow({ href, active, mark, title, trailing, actions, onIntent }: RecentRowProps) {
	return (
		<RowShell title={title} actions={actions} onIntent={onIntent} className="recent-entry" active={active}>
			<RowButton asChild data-active={active || undefined} className="recent-item">
				<Link href={href} aria-current={active ? 'page' : undefined}>
					{mark}
					<span className="recent-title">{title}</span>
					{trailing}
				</Link>
			</RowButton>
		</RowShell>
	);
}

interface RecentCardProps {
	href: string;
	active: boolean;
	/** A 24px tile at the left that says what the row is: the forge's mark, or a chat's bubble. */
	tile: ReactNode;
	title: string;
	/** How long ago it changed, at the top right; it steps aside for Settle and the "more" button. */
	age?: string;
	/** The line under the title, in the meta face: a review's state and its pull request, or a repository's counts. */
	foot: ReactNode;
	actions?: RowAction[];
	onIntent?: () => void;
	/** Moves the row down to Settled; a row with none has no Settle. */
	onSettle?: () => void;
}

/**
 * A row of the sidebar's lists on two lines beside its tile: the title and its age, then the foot. Pointed at, the
 * age gives way to Settle, which moves it down to Settled, and the "more" button. The whole row opens it.
 */
export function RecentCard({
	href,
	active,
	tile,
	title,
	age,
	foot,
	actions = [],
	onIntent,
	onSettle
}: RecentCardProps) {
	return (
		<RowShell
			title={title}
			actions={actions}
			onIntent={onIntent}
			className="recent-card"
			active={active}
			tools={
				onSettle ? (
					<Button variant="ghost" size="sm" className="recent-settle" onClick={onSettle}>
						<CheckIcon />
						Settle
					</Button>
				) : null
			}
		>
			<span className="recent-tile" aria-hidden>
				{tile}
			</span>
			<span className="recent-card-text">
				<span className="recent-card-head">
					<RowButton asChild cover className="recent-card-title">
						<Link href={href} aria-current={active ? 'page' : undefined}>
							<span className="recent-title">{title}</span>
						</Link>
					</RowButton>
					{age ? <span className="recent-age meta">{age}</span> : null}
				</span>
				<span className="recent-card-foot meta">{foot}</span>
			</span>
		</RowShell>
	);
}
