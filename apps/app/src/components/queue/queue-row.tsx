'use client';

import { shortAge } from '@recoder/shared';
import type { PrPerson } from '@recoder/shared';
import { Meter, RowButton, StatusGlyph } from '@recoder/ui';
import { Bot } from 'lucide-react';
import { motion } from 'motion/react';
import { memo, useRef, useState, type MouseEvent, type PointerEvent, type Ref } from 'react';

import type { ProgressSummaries } from '@/lib/api/reviews';
import { entryGlyph, runningLabel, type QueueEntry, type QueueSection } from '@/lib/queue/queue';
import { useQueue } from '@/lib/queue/queue-store';
import { cancelWarm, openRow, warmSoon } from '@/lib/queue/queue-warm';
import { author, plural, pullRef, pullTitle } from '@/lib/shell/format';
import { opensInPlace } from '@/lib/shell/routes';
import { useShell } from '@/lib/shell/shell-store';

import { LIST_ITEM_MOTION } from './queue-motion';
import { QueuePeople } from './queue-people';
import { QueueRowSide } from './queue-row-side';

interface QueueRowProps {
	entry: QueueEntry;
	/** The section the row sits in; when it changes, the row is the one crossing the list. */
	section: QueueSection['id'];
	/** Where the row leads; null without a review, when opening it selects the row or shows the sample notice. */
	href: string | null;
	sample: boolean;
	/** True when the row is part of the list as it first draws, so it does not fade in. */
	quiet: boolean;
	/** True for the last row of its section, which draws the line under it. */
	end: boolean;
	onOpen: (entry: QueueEntry) => void;
	onStart: (entry: QueueEntry) => void;
	/** The presence list measures a leaving row through this. */
	ref?: Ref<HTMLDivElement>;
}

type Progress = ProgressSummaries[string] | undefined;

/** One empty list for every row without assignees, so their avatars skip a render with the row. */
const NOBODY: PrPerson[] = [];

/** Who opened the pull request; an agent's name follows a bot icon. */
function MetaAuthor({ entry }: { entry: QueueEntry }) {
	const by = author(entry.pull.author);

	return (
		<span className="queue-row-author" title={by.agent ? `${by.name}, an agent` : by.name}>
			{by.agent ? <Bot size={12} strokeWidth={1.75} className="shrink-0" aria-hidden /> : null}
			<span className="min-w-0 truncate">{by.name}</span>
		</span>
	);
}

/**
 * How big the change is, how old it is, and what was sent back. The age and
 * the sent-back count each follow a dot, which CSS draws in the gap before
 * them, so a part that a narrow row wraps to a new line leaves its dot behind.
 */
function MetaSize({ entry }: { entry: QueueEntry }) {
	const { pull } = entry;
	const age = shortAge(pull.createdAt);

	return (
		<span className="queue-row-size">
			<span className="queue-row-diff">
				<span>{plural(pull.changedFiles, 'file')}</span>
				<span className="text-ok">+{pull.additions}</span>
				<span className="text-danger">−{pull.deletions}</span>
			</span>
			{age ? <span className="queue-row-dotted">{age}</span> : null}
			{entry.state === 'needs-you' && entry.sent > 0 ? (
				<span className="queue-row-dotted text-sent">{entry.sent} sent back</span>
			) : null}
		</span>
	);
}

/**
 * The line under the title: who opened the pull request, which branch goes
 * into which, then how big and old the change is. CSS draws the dots and the
 * arrow between the parts, so each leaves with its part: a narrow row drops
 * the head branch first, then the base, and truncates the author last. A
 * narrow row puts the size on a line of its own. It renders again only when
 * the row's entry changes, not when the row is selected.
 */
const Meta = memo(function Meta({ entry }: { entry: QueueEntry }) {
	const { pull } = entry;

	return (
		<span className="queue-row-meta">
			<MetaAuthor entry={entry} />
			<span className="queue-row-tail">
				<span className="queue-row-head" title={pull.headRef}>
					{pull.headRef}
				</span>
				<span className="queue-row-base">{pull.base}</span>
				<MetaSize entry={entry} />
			</span>
		</span>
	);
});

/**
 * A running review's note and meter. A queued review's meter stays empty and
 * still, since nothing runs yet; a planning one slides until the task count
 * is known.
 */
function RowProgress({ entry, progress }: { entry: QueueEntry; progress: Progress }) {
	const total = progress?.tasksTotal ?? 0;
	const queued = entry.review?.status === 'queued';

	return (
		<span className="queue-row-progress">
			<span className="shimmer-text">{runningLabel(entry, progress)}</span>
			<Meter
				value={queued ? 0 : total > 0 ? Math.min(progress?.tasksDone ?? 0, total) : null}
				max={total || 1}
				className="queue-row-meter"
				aria-label="Review progress"
			/>
		</span>
	);
}

interface TitleProps {
	/** The row j and k landed on; assistive tech hears it as the current one. */
	selected: boolean;
	onOpen: () => void;
}

/**
 * The row's title: a link to its review, or a button that selects a row
 * without one (or explains the sample); the row's own button starts a
 * review. It covers the row, so the whole row is one target. Arrows keep
 * walking the list while it has focus. The link is a plain anchor, not
 * Next's `Link`: a plain click opens the review through `openRow`, so the
 * queue stays until the review can paint whole, and a click with a key
 * held, or a middle click, opens a tab as any link does. So `Link` would
 * add only its prefetch, which a long queue cannot afford (every review
 * page's server render on load), and its per-row setup. A pointer or the
 * selection resting on the row prefetches its page instead (`warmSoon`).
 */
function Title({ entry, href, selected, onOpen }: Pick<QueueRowProps, 'entry' | 'href'> & TitleProps) {
	const title = pullTitle(entry.pull.title, entry.pull.number);
	const current = selected ? 'true' : undefined;

	if (href) {
		const follow = (event: MouseEvent) => {
			if (!opensInPlace(event)) return;

			event.preventDefault();
			openRow(entry, href);
		};

		return (
			<RowButton asChild cover className="queue-row-title" data-page-keys="move">
				<a
					href={href}
					aria-current={current}
					aria-label={`Open the review of ${title}, #${entry.pull.number}`}
					onClick={follow}
				>
					{title}
				</a>
			</RowButton>
		);
	}

	return (
		<RowButton
			cover
			className="queue-row-title"
			data-page-keys="move"
			aria-current={current}
			aria-label={`${title}, #${entry.pull.number}`}
			onClick={onOpen}
		>
			{title}
		</RowButton>
	);
}

/** Hands the row's element to a ref the parent passed, whichever kind it is. */
function forward(ref: Ref<HTMLDivElement> | undefined, node: HTMLDivElement | null): void {
	if (typeof ref === 'function') ref(node);
	else if (ref) ref.current = node;
}

/**
 * The hover highlight measures rows only on pointer, scroll and resize
 * events, so it cannot follow a spring. A synthetic scroll reaches its
 * window listener and places it on the row under the resting pointer again.
 */
function remeasureHighlight(node: HTMLElement): void {
	node.dispatchEvent(new Event('scroll'));
}

/**
 * Marks `list` while any of its rows springs to a new place, so its hover
 * highlight steps out until they land (queue.css). It is an attribute on the
 * list rather than a `:has()` rule over its rows, which made the browser
 * recheck every row's style on each j press and each hover.
 */
function markShifting(list: Element | null): void {
	list?.toggleAttribute('data-shifting', list.querySelector('.queue-row[data-shifting]') !== null);
}

/**
 * Marks the row while it springs to a new place. Every moving row hides the
 * hover highlight until it lands. The row that changes section also paints
 * over the heads and rows it passes, so their text never shows through it.
 * The marks are set on the element as the move starts, so they cover the
 * first frame. A row that leaves mid-move clears its list's mark once it is gone.
 */
function useCrossing(section: QueueSection['id'], ref: Ref<HTMLDivElement> | undefined) {
	const node = useRef<HTMLDivElement | null>(null);
	const list = useRef<Element | null>(null);
	const [placed, setPlaced] = useState(section);
	const [moved, setMoved] = useState(false);

	if (placed !== section) {
		setPlaced(section);
		setMoved(true);
	}

	return {
		ref: (element: HTMLDivElement | null) => {
			const leaving = !element && node.current?.hasAttribute('data-shifting');

			node.current = element;
			forward(ref, element);

			if (leaving) queueMicrotask(() => markShifting(list.current));
		},
		onLayoutAnimationStart: () => {
			const element = node.current;

			if (!element) return;

			element.setAttribute('data-shifting', '');

			if (moved) element.setAttribute('data-crossing', '');

			list.current = element.parentElement;
			markShifting(list.current);
		},
		onLayoutAnimationComplete: () => {
			const element = node.current;

			setMoved(false);

			if (!element) return;

			element.removeAttribute('data-crossing');
			element.removeAttribute('data-shifting');
			markShifting(element.parentElement);
			remeasureHighlight(element);
		}
	};
}

/**
 * A mouse or pen resting on the row reads its review ahead, so a click
 * opens it from memory; a tap opens at once, so touch reads nothing ahead. A
 * click before the read began drops the plan, since opening reads the review
 * itself; a click while it runs joins it.
 */
function hoverWarm(entry: QueueEntry) {
	return {
		onPointerEnter: (event: PointerEvent) => {
			if (event.pointerType !== 'touch') warmSoon(entry);
		},
		onPointerLeave: () => cancelWarm(entry.key),
		onClick: () => cancelWarm(entry.key)
	};
}

/**
 * The row's live pieces from the store, so a tick of one row's progress or a
 * j press re-renders that row alone. `opening` is true while the shell
 * reads the row's review before it leaves the queue; the row shows as
 * selected meanwhile, so the click reads as taken.
 */
function useRowState(entry: QueueEntry) {
	const id = entry.review?.id;
	const progress = useQueue((state) => (id ? state.progress[id] : undefined));
	const starting = useQueue((state) => !!state.starting[entry.key]);
	const selected = useQueue((state) => state.selected === entry.key);
	const opening = useShell((state) => !!id && state.opening === id);

	return { progress, starting, selected, opening };
}

/**
 * One open pull request. Focus inside it selects it, so the keys step from
 * the row that has focus. When it changes section it moves to its new place
 * on a spring; its glyph morphs and its pill crossfades. Nothing animates on
 * first paint. Resting the pointer on it reads its review ahead. It renders
 * again only when its own props or store slice change, and it measures its
 * place only when its section changes: a j press, a progress tick or a row
 * moving elsewhere in the list moves nothing. Its right-click menu belongs
 * to the list (`QueueList`), so a row sets up no menu of its own.
 */
export const QueueRow = memo(function QueueRow(props: QueueRowProps) {
	const { entry, section, href, sample, quiet, end, onOpen, onStart, ref } = props;
	const { progress, starting, selected, opening } = useRowState(entry);
	const running = entry.state === 'reviewing';
	const crossing = useCrossing(section, ref);
	const hover = hoverWarm(entry);
	const open = () => onOpen(entry);
	const begin = () => onStart(entry);
	const select = () => useQueue.getState().select(entry.key);

	return (
		<motion.div
			{...LIST_ITEM_MOTION}
			initial={quiet ? false : LIST_ITEM_MOTION.initial}
			{...crossing}
			{...hover}
			layoutDependency={section}
			className="queue-row"
			data-queue-row
			data-queue-key={entry.key}
			data-end={end || undefined}
			data-phase={starting ? 'starting' : running ? 'running' : 'idle'}
			data-sample={sample || undefined}
			data-selected={selected || opening || undefined}
			onFocus={select}
		>
			<StatusGlyph kind={entryGlyph(entry)} className="queue-row-glyph" />
			<span className="flex min-w-0 flex-1 flex-col gap-[5px]">
				<span className="flex min-w-0 items-baseline gap-2">
					<QueuePeople people={entry.pull.assignees ?? NOBODY} />
					<Title entry={entry} href={href} selected={selected} onOpen={open} />
					<span className="shrink-0 font-mono text-[12px] text-fg-faint">{pullRef(entry.repo, entry.pull.number)}</span>
				</span>
				{running ? <RowProgress entry={entry} progress={progress} /> : <Meta entry={entry} />}
			</span>
			<QueueRowSide entry={entry} starting={starting} selected={selected} onOpen={open} onStart={begin} />
		</motion.div>
	);
});
