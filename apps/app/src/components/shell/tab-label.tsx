'use client';

import { AnimatedNumber } from '@recoder/ui';
import { Inbox } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useState, type ReactNode } from 'react';

import { repoName } from '@/lib/shell/format';
import type { ReviewTab } from '@/lib/shell/shell-store';

import { Grow } from './grow';
import { TabGlyph } from './tab-glyph';

/** The tab's tooltip: the whole title, then where it lives. */
export function tabTitle(tab: ReviewTab): string {
	return `${tab.title} · ${tab.repo} #${tab.pr}`;
}

interface CountProps {
	/** Hidden at zero or null. */
	value: number | null;
	/** Read after the number by assistive tech: "need you", "open decisions". */
	label: string;
	/** A tinted chip (review tabs) rather than a bare figure (the Queue tab). */
	badge?: boolean;
	high?: boolean;
	/** Render without motion, for the hidden row the bar measures. */
	still?: boolean;
	/**
	 * Holds the room the boot bar kept for the count while its value is not
	 * known yet, so the count lands in place by showing, not by widening the
	 * tab. shell.css sizes it from the digits the boot script left on `<html>`.
	 */
	reserve?: boolean;
}

/**
 * A small mono count after a tab's label. It rolls as it changes and
 * collapses at zero. It grows back in from zero, but a count that first
 * becomes known (on load) shows at once, as the rest of the page does: in
 * the room held for it, when there is one. Room held for a count that comes
 * back as none leaves at once too (`custom` makes `Grow` go without its
 * collapse), in the frame the page's content lands.
 */
function Count({ value, label, badge, high, still, reserve }: CountProps) {
	const [previous, setPrevious] = useState(value);
	const [fromUnknown, setFromUnknown] = useState(true);

	if (value !== previous) {
		setPrevious(value);
		setFromUnknown(previous === null);
	}

	const shown = value ? (
		<span data-ui="tab-count" data-variant={badge ? 'badge' : undefined} data-tone={high ? 'high' : undefined}>
			{still ? value : <AnimatedNumber value={value} />}
			<span className="sr-only"> {label}</span>
		</span>
	) : reserve ? (
		<span data-ui="tab-count" data-reserve aria-hidden />
	) : null;

	if (still) return shown;

	return (
		<AnimatePresence initial={false} custom={fromUnknown}>
			{shown ? (
				<Grow key="count" still={fromUnknown}>
					{shown}
				</Grow>
			) : null}
		</AnimatePresence>
	);
}

interface QueueTabLabelProps {
	waiting: number | null;
	still?: boolean;
	/** Keeps the room the boot bar kept for the count until the count is known. */
	reserve?: boolean;
}

/** The Queue tab's face: the inbox, its name and how many pull requests wait on a decision. */
export function QueueTabLabel({ waiting, still, reserve }: QueueTabLabelProps) {
	return (
		<>
			<Inbox size={14} strokeWidth={1.75} aria-hidden />
			Queue
			<Count value={waiting} label="need you" still={still} reserve={reserve} />
		</>
	);
}

/** True when the title says more than the number beside it (a review without a title falls back to `#214`). */
function hasTitle(tab: ReviewTab): boolean {
	return tab.title.trim() !== '' && tab.title !== `#${tab.pr}`;
}

/** What to call a tab where its number is not beside it: the title, or the number when there is no title. */
export function tabName(tab: ReviewTab): string {
	return hasTitle(tab) ? tab.title : `#${tab.pr}`;
}

/** A review tab's face: its state, the repository and number, the title cut to fit, and the open decisions. */
export function ReviewTabLabel({ tab, still }: { tab: ReviewTab; still?: boolean }) {
	const running = tab.open === null;

	return (
		<>
			<TabGlyph running={running} still={still} />
			<span data-ui="tab-repo">{repoName(tab.repo)}</span>
			<span data-ui="tab-number">#{tab.pr}</span>
			{hasTitle(tab) ? <span data-ui="tab-title">{tab.title}</span> : null}
			{running ? <span className="sr-only">, reviewing</span> : null}
			<Count value={tab.open} label="open" badge high={tab.high} still={still} />
		</>
	);
}

/**
 * A review tab as a row in the More menu: the title and its count, then where
 * it lives at the end, its repository cut short before its number.
 */
export function ReviewTabRow({ tab }: { tab: ReviewTab }): ReactNode {
	return (
		<span className="flex min-w-0 items-center gap-3">
			<span className="flex min-w-0 flex-1 items-center gap-2">
				<span className="min-w-0 truncate">{tabName(tab)}</span>
				<Count value={tab.open} label="open" badge high={tab.high} still />
			</span>
			<span className="flex max-w-[45%] min-w-0 gap-[0.5ch] font-mono text-[11.5px] text-fg-faint">
				<span className="min-w-0 truncate">{repoName(tab.repo)}</span>
				<span className="shrink-0">#{tab.pr}</span>
			</span>
		</span>
	);
}
