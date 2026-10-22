'use client';

import {
	AnimatedNumber,
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from '@recoder/ui';
import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, type FocusEvent } from 'react';

import type { ReviewTab } from '@/lib/shell/shell-store';

import { ReviewTabRow } from './tab-label';
import { TabGlyph } from './tab-glyph';
import { useTabActions } from './use-tab-actions';

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
 * The tabs that do not fit in the bar, in a menu at its end. Picking one
 * sends focus back to the trigger, as menus do; after a pointer pick it lands
 * there without a focus ring, which only a keyboard pick should leave.
 */
export function TabOverflow({ tabs }: { tabs: ReviewTab[] }) {
	const { open } = useTabActions();
	const pointerLast = usePointerLast();
	const picked = useRef(false);

	function pick(id: string): void {
		picked.current = true;
		open(id);
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
				<Button variant="quiet" data-slot="tab-more" aria-label={`${tabs.length} more tabs`} onFocus={onFocus}>
					<MoreFace count={tabs.length} />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-[340px] max-w-[calc(100vw-16px)]">
				{tabs.map((tab) => (
					<DropdownMenuItem key={tab.id} icon={<TabGlyph running={tab.open === null} />} onSelect={() => pick(tab.id)}>
						<ReviewTabRow tab={tab} />
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
