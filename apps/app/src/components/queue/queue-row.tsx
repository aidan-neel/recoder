'use client';

import { shortAge } from '@recoder/shared';
import { ContextMenu, ContextMenuTrigger, Meter, RowButton, StatusGlyph } from '@recoder/ui';
import { Bot } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { memo, useRef, useState, type Ref } from 'react';

import type { ProgressSummaries } from '@/lib/api/reviews';
import { entryGlyph, runningLabel, type QueueEntry, type QueueSection } from '@/lib/queue/queue';
import { useQueue } from '@/lib/queue/queue-store';
import { author, plural, pullRef, pullTitle } from '@/lib/shell/format';

import { LIST_ITEM_MOTION } from './queue-motion';
import { QueuePeople } from './queue-people';
import { QueueRowMenu } from './queue-row-menu';
import { QueueRowSide } from './queue-row-side';
import { rowActions } from './row-actions';

interface QueueRowProps {
	entry: QueueEntry;
	/** The section the row sits in; when it changes, the row is the one crossing the list. */
	section: QueueSection['id'];
	/** Where the row leads; null without a review, when opening it selects the row or shows the sample notice. */
	href: string | null;
	sample: boolean;
	onOpen: (entry: QueueEntry) => void;
	onStart: (entry: QueueEntry) => void;
	/** Asks before deleting the row's review. */
	onDelete: (entry: QueueEntry) => void;
	/** The presence list measures a leaving row through this. */
	ref?: Ref<HTMLDivElement>;
}

type Progress = ProgressSummaries[string] | undefined;

/** Where the branch goes, how big the change is, how old it is, and what was sent back. */
function Meta({ entry }: { entry: QueueEntry }) {
	const { pull } = entry;
	const by = author(pull.author);
	const age = shortAge(pull.createdAt);

	return (
		<span className="queue-row-meta">
			<span className="queue-row-author" title={by.agent ? `${by.name}, an agent` : by.name}>
				{by.agent ? <Bot size={12} strokeWidth={1.75} aria-hidden /> : null}
				{by.name}
			</span>
			<span aria-hidden>·</span>
			<span className="min-w-0 truncate text-fg-subtle" title={pull.headRef}>
				{pull.headRef}
			</span>
			<span aria-hidden>→</span>
			<span className="shrink-0">{pull.base}</span>
			<span aria-hidden>·</span>
			<span className="shrink-0">{plural(pull.changedFiles, 'file')}</span>
			<span className="shrink-0 text-ok">+{pull.additions}</span>
			<span className="shrink-0 text-danger">−{pull.deletions}</span>
			{age ? (
				<>
					<span aria-hidden>·</span>
					<span className="shrink-0">{age}</span>
				</>
			) : null}
			{entry.state === 'needs-you' && entry.sent > 0 ? (
				<>
					<span aria-hidden>·</span>
					<span className="shrink-0 text-sent">{entry.sent} sent back</span>
				</>
			) : null}
		</span>
	);
}

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
 * walking the list while it has focus.
 */
function Title({ entry, href, selected, onOpen }: Pick<QueueRowProps, 'entry' | 'href'> & TitleProps) {
	const title = pullTitle(entry.pull.title, entry.pull.number);
	const current = selected ? 'true' : undefined;

	if (href) {
		return (
			<RowButton asChild cover className="queue-row-title" data-page-keys="move">
				<Link href={href} aria-current={current} aria-label={`Open the review of ${title}, #${entry.pull.number}`}>
					{title}
				</Link>
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
 * Marks the row while it springs to a new place. Every moving row hides the
 * hover highlight until it lands. The row that changes section also paints
 * over the heads and rows it passes, so their text never shows through it.
 * The marks are set on the element as the move starts, so they cover the
 * first frame.
 */
function useCrossing(section: QueueSection['id'], ref: Ref<HTMLDivElement> | undefined) {
	const node = useRef<HTMLDivElement | null>(null);
	const [placed, setPlaced] = useState(section);
	const [moved, setMoved] = useState(false);

	if (placed !== section) {
		setPlaced(section);
		setMoved(true);
	}

	return {
		ref: (element: HTMLDivElement | null) => {
			node.current = element;
			forward(ref, element);
		},
		onLayoutAnimationStart: () => {
			node.current?.setAttribute('data-shifting', '');

			if (moved) node.current?.setAttribute('data-crossing', '');
		},
		onLayoutAnimationComplete: () => {
			const element = node.current;

			setMoved(false);

			if (!element) return;

			element.removeAttribute('data-crossing');
			element.removeAttribute('data-shifting');
			remeasureHighlight(element);
		}
	};
}

/** The row's live pieces from the store, so a tick of one row's progress or a j press re-renders that row alone. */
function useRowState(entry: QueueEntry) {
	const id = entry.review?.id;
	const progress = useQueue((state) => (id ? state.progress[id] : undefined));
	const starting = useQueue((state) => !!state.starting[entry.key]);
	const selected = useQueue((state) => state.selected === entry.key);

	return { progress, starting, selected };
}

/**
 * One open pull request. Focus inside it selects it, so the keys step from
 * the row that has focus. When it changes section it moves to its new place
 * on a spring; its glyph morphs and its pill crossfades. Nothing animates on
 * first paint. It renders again only when its own props or store slice change,
 * and it measures its place only when its section changes: a j press or a
 * progress tick moves nothing. When rows come, go or reorder, the list's heads
 * render too and measure the whole layout group.
 */
export const QueueRow = memo(function QueueRow(props: QueueRowProps) {
	const { entry, section, href, sample, onOpen, onStart, onDelete, ref } = props;
	const { progress, starting, selected } = useRowState(entry);
	const running = entry.state === 'reviewing';
	const crossing = useCrossing(section, ref);
	const open = () => onOpen(entry);
	const begin = () => onStart(entry);
	const select = () => useQueue.getState().select(entry.key);

	return (
		<ContextMenu>
			<ContextMenuTrigger>
				<motion.div
					{...LIST_ITEM_MOTION}
					{...crossing}
					layoutDependency={section}
					className="queue-row"
					data-queue-row
					data-queue-key={entry.key}
					data-phase={starting ? 'starting' : running ? 'running' : 'idle'}
					data-selected={selected || undefined}
					onFocus={select}
				>
					<StatusGlyph kind={entryGlyph(entry)} className="queue-row-glyph" />
					<span className="flex min-w-0 flex-1 flex-col gap-[5px]">
						<span className="flex min-w-0 items-baseline gap-2">
							<QueuePeople people={entry.pull.assignees ?? []} />
							<Title entry={entry} href={href} selected={selected} onOpen={open} />
							<span className="shrink-0 font-mono text-[12px] text-fg-faint">
								{pullRef(entry.repo, entry.pull.number)}
							</span>
						</span>
						{running ? <RowProgress entry={entry} progress={progress} /> : <Meta entry={entry} />}
					</span>
					<QueueRowSide entry={entry} starting={starting} selected={selected} onOpen={open} onStart={begin} />
				</motion.div>
			</ContextMenuTrigger>
			<QueueRowMenu actions={rowActions(entry, { href, sample, starting, onOpen, onStart, onDelete })} />
		</ContextMenu>
	);
});
