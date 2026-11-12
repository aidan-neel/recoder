'use client';

import { AnimatedNumber, HoverList } from '@recoder/ui';
import { AnimatePresence, motion } from 'motion/react';
import { memo, startTransition, useEffect, useState, type CSSProperties, type ReactNode, type Ref } from 'react';

import { entryHref, type QueueEntry, type QueueSection } from '@/lib/queue/queue';

import { LIST_ITEM_MOTION } from './queue-motion';
import { QueueRow } from './queue-row';
import { QueueListMenu } from './queue-row-menu';

interface QueueListProps {
	sections: QueueSection[];
	sample: boolean;
	/** Where a row leads; null gives it no link. The review or pull request page by default. */
	href?: (entry: QueueEntry) => string | null;
	onOpen: (entry: QueueEntry) => void;
	onStart: (entry: QueueEntry) => void;
	/** Asks before deleting a row's review. */
	onDelete: (entry: QueueEntry) => void;
	/**
	 * The rows the first commit draws: those on the first screen. The rest
	 * follow in batches once the browser has painted, in the space kept for
	 * them below. Without it every row draws at once.
	 */
	firstRows?: number;
}

/** The rows each later batch adds, so no commit after the first paint grows with the queue. */
const BATCH_ROWS = 12;

/** How far the list has drawn: the rows it draws, and once every row is in, the items it drew until then. */
interface Fill {
	limit: number;
	known: Set<string> | null;
}

/** Runs `run` in a task after the browser's next paint. Returns the cancel. */
function afterPaint(run: () => void): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;

	const frame = requestAnimationFrame(() => {
		timer = setTimeout(run, 0);
	});

	return () => {
		cancelAnimationFrame(frame);
		clearTimeout(timer);
	};
}

function rowCount(sections: QueueSection[]): number {
	return sections.reduce((count, section) => count + section.entries.length, 0);
}

/** Every head's and row's key, as the list keys them. */
function keysOf(sections: QueueSection[]): Set<string> {
	return new Set(
		sections.flatMap((section) => [`head:${section.id}`, ...section.entries.map((entry) => `row:${entry.key}`)])
	);
}

/**
 * How many rows the list draws, and which items are quiet (no fade-in). The
 * first commit draws `first` rows; then, a task after each paint, a batch
 * more in a transition, so React yields while it builds them and each commit
 * stays small, until every row is in. Everything drawn until then is part of
 * the list as it first draws, so it stays quiet; only what arrives after
 * fades in. An item's answer never changes once it is drawn, so no row
 * renders again when the fill ends.
 */
function useRowLimit(sections: QueueSection[], first: number | undefined) {
	const [fill, setFill] = useState<Fill>(() =>
		first !== undefined && first < rowCount(sections)
			? { limit: first, known: null }
			: { limit: Infinity, known: keysOf(sections) }
	);

	useEffect(() => {
		if (fill.known) return;

		const next = fill.limit + BATCH_ROWS;
		const done = next >= rowCount(sections);

		return afterPaint(() =>
			startTransition(() => setFill(done ? { limit: Infinity, known: keysOf(sections) } : { limit: next, known: null }))
		);
	}, [fill, sections]);

	return { limit: fill.limit, quiet: (key: string) => fill.known === null || fill.known.has(key) };
}

interface QueueHeadProps {
	section: QueueSection;
	first: boolean;
	/** True when the head is part of the list as it first draws, so it does not fade in. */
	quiet: boolean;
	ref?: Ref<HTMLHeadingElement>;
}

/** A section's title and count. Like the rows, it takes its new place at once when a section above appears or empties; the count rolls. */
function QueueHead({ section, first, quiet, ref }: QueueHeadProps) {
	return (
		<motion.h2
			ref={ref}
			{...LIST_ITEM_MOTION}
			initial={quiet ? false : LIST_ITEM_MOTION.initial}
			layoutDependency={section.id}
			className="queue-head"
			data-first={first || undefined}
		>
			{section.title}
			<AnimatedNumber value={section.entries.length} className="font-mono text-[11.5px] text-fg-faint" />
		</motion.h2>
	);
}

/**
 * The space the rows not drawn yet will take, a row or a head at a time, so
 * the list is as tall on its first paint as once every row is in.
 */
function RestSpace({ rows, heads }: { rows: number; heads: number }) {
	if (rows === 0) return null;

	return (
		<div aria-hidden className="queue-rest" style={{ '--rest-rows': rows, '--rest-heads': heads } as CSSProperties} />
	);
}

/**
 * Every section's head and rows as siblings of one list, so a row that
 * changes section keeps its element (and focus) and springs to its new place.
 * The rows and heads around it make room at once: springing every row of a
 * hundred-row queue cost frames of over 100ms. New rows fade in; closed ones
 * fade out. Each row reads its own progress, pending start and selection, so
 * the list renders again only when its sections change, and then only the
 * rows that changed: presence that affected layout would hand every row a new
 * context, and every row's motion element would render again. With
 * `firstRows`, the first commit draws only the first screen, so a long queue
 * paints sooner; the rows below come in after, without fading in.
 */
export const QueueList = memo(function QueueList({
	sections,
	sample,
	href = (entry) => entryHref(entry, sample),
	onOpen,
	onStart,
	onDelete,
	firstRows
}: QueueListProps) {
	const { limit, quiet } = useRowLimit(sections, firstRows);
	const items: ReactNode[] = [];
	const rest = { rows: 0, heads: 0 };
	let drawn = 0;

	sections.forEach((section, index) => {
		const headKey = `head:${section.id}`;
		const last = section.entries.at(-1);

		if (drawn >= limit) rest.heads += 1;
		else items.push(<QueueHead key={headKey} section={section} first={index === 0} quiet={quiet(headKey)} />);

		for (const entry of section.entries) {
			const key = `row:${entry.key}`;

			if (drawn >= limit) {
				rest.rows += 1;
				continue;
			}

			drawn += 1;

			items.push(
				<QueueRow
					key={key}
					entry={entry}
					section={section.id}
					href={href(entry)}
					sample={sample}
					quiet={quiet(key)}
					end={entry === last}
					onOpen={onOpen}
					onStart={onStart}
				/>
			);
		}
	});

	return (
		<QueueListMenu
			sections={sections}
			sample={sample}
			href={href}
			onOpen={onOpen}
			onStart={onStart}
			onDelete={onDelete}
		>
			<HoverList className="queue-list" itemSelector="[data-queue-row]" highlightClassName="queue-hover">
				<AnimatePresence initial={false} mode="popLayout" presenceAffectsLayout={false}>
					{items}
				</AnimatePresence>
				<RestSpace {...rest} />
			</HoverList>
		</QueueListMenu>
	);
});
