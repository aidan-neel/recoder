'use client';

import {
	AnimatedNumber,
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Skeleton
} from '@recoder/ui';
import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, type FocusEvent } from 'react';

import type { ReviewTab } from '@/lib/shell/shell-store';
import { goToTab } from '@/lib/shell/tab-actions';

import { ReviewTabRow } from './tab-label';
import { TabGlyph } from './tab-glyph';

/** The More trigger's face: the word, how many tabs it holds, and a chevron. `still` skips the roll, for the ruler. */
export function MoreFace({ count, still }: { count: number; still?: boolean }) {
	return (
		<>
			More
			<span data-ui="tab-count">{still ? count : <AnimatedNumber value={count} />}</span>
			<ChevronDown aria-hidden />
		</>
	);
}

/** True while the last thing the person pressed was a pointer rather than a key. */
function usePointerLast() {
	const pointer = useRef(false);

	useEffect(() => {
		const press = () => (pointer.current = true);
		const key = () => (pointer.current = false);

		window.addEventListener('pointerdown', press, true);
		window.addEventListener('keydown', key, true);

		return () => {
			window.removeEventListener('pointerdown', press, true);
			window.removeEventListener('keydown', key, true);
		};
	}, []);

	return pointer;
}

/**
 * The page's own tab in the menu while its review loads: the row it will
 * take, with a placeholder for its name. It cannot be picked, but shows at
 * full strength, since its skeleton is already faint.
 */
function OpeningRow() {
	return (
		<DropdownMenuItem disabled icon={<TabGlyph running />} className="data-disabled:opacity-100">
			<Skeleton className="h-3 w-40" />
			<span className="sr-only">Loading this review</span>
		</DropdownMenuItem>
	);
}

interface TabOverflowProps {
	tabs: ReviewTab[];
	/** How many tabs the menu holds: its tabs, and the page's own before it opens, when the fit keeps its room here. */
	count: number;
	/** The page's own tab is in the menu, since the bar is too narrow for it; the trigger then reads as active. */
	holdsActive: boolean;
}

/**
 * The tabs that do not fit in the bar, in a menu at its end, and the page's
 * own tab as a loading row while it opens. Picking one sends focus back to
 * the trigger, as menus do; after a pointer pick it lands there without a
 * focus ring, which only a keyboard pick should leave.
 */
export function TabOverflow({ tabs, count, holdsActive }: TabOverflowProps) {
	const pointerLast = usePointerLast();
	const picked = useRef(false);

	function pick(id: string): void {
		picked.current = true;
		goToTab(id);
	}

	function onFocus(event: FocusEvent<HTMLButtonElement>): void {
		if (!picked.current) return;

		picked.current = false;

		if (!pointerLast.current) return;

		const trigger = event.currentTarget;

		trigger.blur();
		trigger.focus({ focusVisible: false, preventScroll: true });
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger>
				<Button
					variant="quiet"
					data-slot="tab-more"
					data-holds-active={holdsActive || undefined}
					aria-label={`${count} more tabs`}
					onFocus={onFocus}
				>
					<MoreFace count={count} />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-[340px] max-w-[calc(100vw-16px)]">
				{tabs.map((tab) => (
					<DropdownMenuItem key={tab.id} icon={<TabGlyph running={tab.open === null} />} onSelect={() => pick(tab.id)}>
						<ReviewTabRow tab={tab} />
					</DropdownMenuItem>
				))}
				{count > tabs.length ? <OpeningRow /> : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
