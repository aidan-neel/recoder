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
import { Fragment, type ComponentType, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

import { useIntent } from '@/lib/shell/intent';
import type { PickHow } from '@/lib/shell/row-selection';

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

/** How a row that can be picked for a bulk action answers a modified click and Shift+arrows (`RowSelectionScope`). */
export interface RowPick {
	id: string;
	onPick: (how: PickHow) => void;
	onStep: (step: 1 | -1) => void;
	onClear: () => void;
}

/** Shift picks a range, Cmd or Ctrl one row, and anything else opens the row. */
function pickHow(event: MouseEvent): PickHow {
	if (event.shiftKey) return 'range';

	return event.metaKey || event.ctrlKey ? 'toggle' : 'open';
}

/**
 * The row's handlers for picking: clicks on the row itself (not its tools or a menu it opened), Shift+↑/↓, and Escape,
 * which empties the selection from a focused row even when an open tooltip has already taken the key for itself.
 */
function pickHandlers({ id, onPick, onStep, onClear }: RowPick) {
	return {
		'data-row-id': id,
		onMouseDown(event: MouseEvent<HTMLElement>) {
			if (event.shiftKey) event.preventDefault();
		},
		onClickCapture(event: MouseEvent<HTMLElement>) {
			const target = event.target as Element;

			if (!event.currentTarget.contains(target) || target.closest('.thread-tools')) return;

			const how = pickHow(event);

			if (how !== 'open') event.preventDefault();

			onPick(how);
		},
		onKeyDown(event: KeyboardEvent<HTMLElement>) {
			if (!event.currentTarget.contains(event.target as Node)) return;

			if (event.key === 'Escape') {
				onClear();

				return;
			}

			const step = { ArrowDown: 1, ArrowUp: -1 }[event.key] as 1 | -1 | undefined;

			if (!step || !event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;

			event.preventDefault();
			onStep(step);
		}
	};
}

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
	/** How many rows its Settle takes: more than one while it is part of a selection. */
	settleCount?: number;
	/** Picked with others for one action (Shift or Cmd/Ctrl-click, Shift+arrows). */
	selected?: boolean;
	pick?: RowPick;
}

/**
 * One review or chat in the sidebar's lists. Detailed, it is two lines: the title and its age, then where it lives and
 * its state as a pill, with an unread dot in the gutter. Compact, it is one line: a glyph, the title, then the dot and
 * the age. Both are always drawn, and the CSS shows the one the density asks for, so a change of setting or of state
 * swaps ink in place and never moves a row. The whole row opens it; a right click opens its menu, and pointed at or
 * focused, the age gives way to Settle and the "more" button, which opens the same menu. A row with `pick` can be
 * picked with others: Shift or Cmd/Ctrl-click and Shift+↑/↓ select instead of opening, and a selected row wears the
 * accent's tint.
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
	onSettle,
	settleCount = 1,
	selected = false,
	pick
}: ThreadRowProps) {
	const intent = useIntent(onIntent);
	const said = [status, unread ? 'unread' : null, selected ? 'selected' : null].filter(Boolean).join(', ');
	const tools = Number(Boolean(onSettle)) + Number(actions.length > 0);
	const settleLabel = settleCount > 1 ? `Settle ${settleCount}` : 'Settle';

	const row = (
		<div
			className="thread-row"
			data-recent=""
			data-density={density}
			data-active={active || undefined}
			data-unread={unread || undefined}
			data-tools={tools || undefined}
			data-selected={selected || undefined}
			{...intent}
			{...(pick ? pickHandlers(pick) : {})}
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
						<Tooltip content={settleLabel}>
							<Button
								variant="ghost"
								size="icon"
								aria-label={settleCount > 1 ? `Settle ${settleCount} selected` : `Settle ${title}`}
								onClick={onSettle}
							>
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

	const contextActions: RowAction[] = onSettle
		? [{ id: 'settle', label: settleLabel, icon: CheckIcon, onSelect: onSettle }, ...actions]
		: actions;

	if (contextActions.length === 0) return row;

	return (
		<ContextMenu>
			<ContextMenuTrigger>{row}</ContextMenuTrigger>
			<ContextMenuContent className="w-[200px]">
				<ActionItems actions={contextActions} parts={CONTEXT_PARTS} />
			</ContextMenuContent>
		</ContextMenu>
	);
}
