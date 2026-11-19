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
	RowButton,
	Tooltip
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

/** `auto` follows Settings → Appearance → Sidebar rows; `compact` is one line whatever the setting. */
type Density = 'auto' | 'compact';

interface ThreadRowProps {
	href: string;
	active: boolean;
	title: string;
	/** How long ago it changed. Pointed at, it gives way to the row's tools. */
	age: string;
	/** The 16px mark of a compact row: a review's state, a chat, or how a settled pull request ended. */
	glyph: ReactNode;
	/** The start of a detailed row's second line: where it lives, the repository and its pull request. */
	place: ReactNode;
	/** The end of a detailed row's second line: the state as a pill. */
	pill?: ReactNode;
	/** The state the glyph or pill shows, read after the title by assistive tech. */
	status?: string;
	/** It changed since this browser last had it open: a dot, and the title in full ink. */
	unread?: boolean;
	density?: Density;
	actions?: RowAction[];
	/** Runs once the pointer or focus has rested on the row: prefetching its page. */
	onIntent?: () => void;
	/** Moves the row down to Settled; a row with none has no Settle. */
	onSettle?: () => void;
}

/**
 * One review or chat in the sidebar's lists. Detailed, it is two lines: the title and its age, then where it lives and
 * its state as a pill, with an unread dot in the gutter. Compact, it is one line: a glyph, the title, then the dot and
 * the age. Both are always drawn, and the CSS shows the one the density asks for, so a change of setting or of state
 * swaps ink in place and never moves a row. The whole row opens it; a right click opens its menu, and pointed at or
 * focused, the age gives way to Settle and the "more" button, which opens the same menu.
 */
export function ThreadRow({
	href,
	active,
	title,
	age,
	glyph,
	place,
	pill,
	status,
	unread = false,
	density = 'auto',
	actions = [],
	onIntent,
	onSettle
}: ThreadRowProps) {
	const intent = useIntent(onIntent);
	const said = [status, unread ? 'unread' : null].filter(Boolean).join(', ');
	const tools = Number(Boolean(onSettle)) + Number(actions.length > 0);

	const row = (
		<div
			className="thread-row"
			data-recent=""
			data-density={density}
			data-active={active || undefined}
			data-unread={unread || undefined}
			data-tools={tools || undefined}
			{...intent}
		>
			<span className="thread-glyph">{glyph}</span>
			<span className="thread-text">
				<span className="thread-head">
					<RowButton asChild cover className="thread-link">
						<Link href={href} aria-current={active ? 'page' : undefined}>
							<span className="thread-title">{title}</span>
							{said ? <span className="sr-only">, {said}</span> : null}
						</Link>
					</RowButton>
					<span className="thread-trail">
						<span className="thread-dot" aria-hidden />
						<span className="thread-age">{age}</span>
					</span>
				</span>
				<span className="thread-foot">
					<span className="thread-place">{place}</span>
					{pill}
				</span>
			</span>
			{tools > 0 ? (
				<span className="thread-tools" skullet-ignore="">
					{onSettle ? (
						<Tooltip content="Settle">
							<Button variant="ghost" size="icon" aria-label={`Settle ${title}`} onClick={onSettle}>
								<CheckIcon />
							</Button>
						</Tooltip>
					) : null}
					{actions.length > 0 ? (
						<DropdownMenu>
							<DropdownMenuTrigger>
								<Button variant="ghost" size="icon" aria-label={`More for ${title}`}>
									<DotsThreeIcon />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start" className="w-[200px]">
								<ActionItems actions={actions} parts={DROPDOWN_PARTS} />
							</DropdownMenuContent>
						</DropdownMenu>
					) : null}
				</span>
			) : null}
		</div>
	);

	if (actions.length === 0) return row;

	return (
		<ContextMenu>
			<ContextMenuTrigger>{row}</ContextMenuTrigger>
			<ContextMenuContent className="w-[200px]">
				<ActionItems actions={actions} parts={CONTEXT_PARTS} />
			</ContextMenuContent>
		</ContextMenu>
	);
}
