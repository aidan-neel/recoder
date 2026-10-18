'use client';

import { Button, NavPill } from '@recoder/ui';
import { X } from 'lucide-react';
import Link from 'next/link';
import type { MouseEvent, ReactNode } from 'react';

import { useShell } from '@/lib/shell/shell-store';

interface TopTabProps {
	/** The queue's id or a review's id. */
	id: string;
	/** Where the tab leads. Without one the tab is a plain label, as in the site's demo, which never navigates. */
	href?: string;
	/** Wears the pill: the page shows, or the bar is heading there. */
	active: boolean;
	/** The page on screen is this tab's, so a plain click has nowhere to go. */
	current?: boolean;
	/** The native tooltip: the full title when the label is cut short. */
	title?: string;
	/** What the close button names ("Close api #214"); review tabs only. */
	closeLabel?: string;
	/** Closes the tab; `keyboard` is true when the X was pressed with a key rather than clicked. */
	onClose?: (keyboard: boolean) => void;
	children: ReactNode;
}

/** True for a click that opens the link in place: no key held to open it in a new browser tab or window. */
function plain(event: MouseEvent): boolean {
	return !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * One tab in the top bar: a link that sits on the bar's sliding pill (a kit
 * `NavPill`, inside the strip's `NavPillGroup`) while its page shows. Review
 * tabs close from an X that replaces their mark on hover or keyboard focus
 * (Tab reaches it after the link), a middle click, or the context menu.
 */
export function TopTab({ id, href, active, current = false, title, closeLabel, onClose, children }: TopTabProps) {
	/**
	 * The link lets go of focus once used, so the page's own Enter works
	 * after a click; a key press on the tab of the page on screen keeps it.
	 * A plain click on that tab does nothing, so it never drops the page's
	 * address (a review's `?item=`).
	 */
	function onClick(event: MouseEvent<HTMLAnchorElement>): void {
		const stays = current && plain(event);

		if (stays) event.preventDefault();
		if (!stays || event.detail > 0) event.currentTarget.blur();
	}

	/** A middle click closes the tab instead of opening the link in a new browser tab. */
	function onAuxClick(event: MouseEvent): void {
		if (event.button !== 1 || !onClose) return;

		event.preventDefault();
		onClose(false);
	}

	/** Holding the middle button down would start the browser's autoscroll. */
	function onMouseDown(event: MouseEvent): void {
		if (event.button === 1 && onClose) event.preventDefault();
	}

	return (
		<div data-ui="top-tab" data-state={active ? 'active' : 'inactive'} data-tab={onClose ? id : undefined}>
			{active ? <NavPill value={id} className="bg-menu" /> : null}
			{href ? (
				<Link
					href={href}
					data-ui="top-tab-link"
					data-tab-id={id}
					aria-current={active ? 'page' : undefined}
					title={title}
					draggable={false}
					onClick={onClick}
					onNavigate={() => useShell.getState().setHeading(id)}
					onAuxClick={onAuxClick}
					onMouseDown={onMouseDown}
				>
					{children}
				</Link>
			) : (
				<span data-ui="top-tab-link" title={title}>
					{children}
				</span>
			)}
			{onClose ? (
				<Button
					variant="quiet"
					size="icon"
					data-slot="tab-close"
					aria-label={closeLabel}
					onClick={(event) => onClose(event.detail === 0)}
					className="size-[18px] min-w-[18px] rounded-[5px]"
				>
					<X className="size-3" strokeWidth={2} />
				</Button>
			) : null}
		</div>
	);
}
