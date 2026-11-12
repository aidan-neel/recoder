'use client';

import { Card, cn, SwapText } from '@recoder/ui';
import { useEffect, useId, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';

import { rememberHeight, type GroupKey } from '@/lib/settings/last-counts';

interface SettingsGroupProps {
	title: string;
	/**
	 * Names the group for its styles (`data-group`). Once its rows have
	 * loaded, its height at this window width is kept for the next load's
	 * skeleton.
	 */
	group?: GroupKey;
	/** True while the card shows what the next load won't (an open editor, a failure), so its height is not kept. */
	transient?: boolean;
	/** Sits at the right of the title (an "Add provider" button). */
	action?: ReactNode;
	/** True while the rows are placeholders, so a screen reader hears the group as still loading. */
	busy?: boolean;
	/** For a placeholder group sized before React runs: the CSS variables that set its rows and height, and whether it shows. */
	style?: CSSProperties;
	children: ReactNode;
}

/** How long a group's height holds still before it is kept, so a row folding in or out is kept once, at its end. */
const SETTLE_MS = 300;

/**
 * Keeps a loaded group's height once it has held still. A group hidden with
 * its page measures nothing, so it keeps nothing.
 */
function useKeptHeight(section: RefObject<HTMLElement | null>, group: GroupKey | undefined, keep: boolean): void {
	useEffect(() => {
		const element = section.current;

		if (!element || !group || !keep) return;

		let timer: ReturnType<typeof setTimeout> | undefined;

		const observer = new ResizeObserver(() => {
			clearTimeout(timer);

			timer = setTimeout(() => {
				const { height } = element.getBoundingClientRect();

				if (height > 0) rememberHeight(group, height);
			}, SETTLE_MS);
		});

		observer.observe(element);

		return () => {
			clearTimeout(timer);
			observer.disconnect();
		};
	}, [section, group, keep]);
}

/** The group whose placeholder had focus as its section's skeleton left, for the loaded group of that name to take. */
let focusFor: GroupKey | null = null;

/**
 * Hands focus on as a section's skeleton (`root`) leaves for the loaded
 * section: when a button in a placeholder group has focus, the loaded group
 * of the same name takes it, in the same commit, so the keyboard keeps its
 * place instead of falling back to the page. Only that commit can claim it,
 * so a group that mounts later never takes focus.
 */
export function useFocusHandOff(root: RefObject<HTMLElement | null>): void {
	useLayoutEffect(() => {
		const element = root.current;

		return () => {
			const focused = document.activeElement;

			if (!element || !(focused instanceof HTMLElement) || !element.contains(focused)) return;

			focusFor = (focused.closest<HTMLElement>('[data-group]')?.dataset.group as GroupKey | undefined) ?? null;

			queueMicrotask(() => {
				focusFor = null;
			});
		};
	}, [root]);
}

/** Takes focus handed on by its group's placeholder ({@link useFocusHandOff}): its head's button, else its first control. */
function useTakeFocus(section: RefObject<HTMLElement | null>, group: GroupKey | undefined, busy: boolean): void {
	useLayoutEffect(() => {
		const element = section.current;

		if (busy || !group || focusFor !== group || !element) return;

		focusFor = null;

		const control =
			element.querySelector<HTMLElement>('.settings-group-head :is(button, a[href])') ??
			element.querySelector<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled)');

		control?.focus();
	}, [section, group, busy]);
}

/** A titled card of settings rows, split by hairlines. */
export function SettingsGroup({ title, group, transient, action, busy, style, children }: SettingsGroupProps) {
	const id = useId();
	const section = useRef<HTMLElement>(null);

	useKeptHeight(section, group, !busy && !transient);
	useTakeFocus(section, group, Boolean(busy));

	return (
		<section
			ref={section}
			data-ui="settings-group"
			data-group={group}
			aria-labelledby={id}
			aria-busy={busy || undefined}
			className="settings-group"
			style={style}
		>
			<div className="settings-group-head">
				<h2 id={id} className="settings-group-title">
					{title}
				</h2>
				{action}
			</div>
			<Card className="settings-list">{children}</Card>
		</section>
	);
}

interface SettingsRowProps {
	/** One line; a name too long for it ends in an ellipsis. */
	name: ReactNode;
	/** One quiet line under the name. A new line replaces the old one after it fades out, so the two never overlap. */
	description?: ReactNode;
	/** Before the name: a CLI's state glyph. */
	leading?: ReactNode;
	className?: string;
	/** The control, at the row's right end. */
	children?: ReactNode;
}

/** One setting: its name and a line on what it does, with its control at the right. */
export function SettingsRow({ name, description, leading, className, children }: SettingsRowProps) {
	return (
		<div data-ui="settings-row" className={cn('settings-row', className)}>
			{leading}
			<div className="min-w-0 flex-1">
				<p className="settings-row-name">{name}</p>
				{description ? (
					<SwapText mode="wait" className="settings-row-desc">
						{description}
					</SwapText>
				) : null}
			</div>
			{children ? <div className="settings-row-control">{children}</div> : null}
		</div>
	);
}
