'use client';

import { ScrollArea, whenIdle } from '@recoder/ui';
import dynamic from 'next/dynamic';
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { SetupSkeleton } from '@/components/setup/setup-skeleton';
import type { Unloaded } from '@/lib/queue/headline';
import { entryStatus, queueSections, type QueueEntry, type QueueSection } from '@/lib/queue/queue';
import { keepMeasure, useSkeletonShape } from '@/lib/queue/queue-snapshot';
import { useQueue } from '@/lib/queue/queue-store';
import { useSetupGate, useSetupSteps, type SetupGate } from '@/lib/setup/setup-gate';
import { pullTitle } from '@/lib/shell/format';
import { beforeMount } from '@/lib/shell/mounted';
import { rootScale } from '@/lib/shell/root-scale';
import { useShell, type QueueScope } from '@/lib/shell/shell-store';

import { DeleteReviewDialog, type DeleteTarget } from './delete-review-dialog';
import { QueueHeadline } from './queue-headline';
import { QueueList } from './queue-list';
import { DownNotice, EmptyNotice, NoPullsActions, QueueNotes } from './queue-notices';
import { QueueLoading, QueueSkeleton, ROW_HEIGHT } from './queue-skeleton';
import { focusSelected, useQueueControls, useQueueSelection } from './use-queue-controls';

/** First run's skeleton while its code loads, shaped by the steps the server reported. */
function FirstRunLoading() {
	return <SetupSkeleton steps={useSetupSteps()} />;
}

/** First run loads only when the gate needs it, so the queue never ships the checklist, its dialogs and the code view. */
const FirstRun = dynamic(() => import('@/components/setup/first-run').then((module) => module.FirstRun), {
	ssr: false,
	loading: FirstRunLoading
});

/**
 * `checking`: first run may still take the page, so the skeleton holds it.
 * `reconnecting`: the server answered after the page said it was down, and
 * the setup check runs again before first run or the queue takes the page.
 */
type View = 'checking' | 'loading' | 'ready' | 'offline' | 'failed' | 'reconnecting' | 'empty';

/** How the first load failed: the server never answered, or answered with an error or too late. */
type Down = 'offline' | 'failed';

const NO_SECTIONS: QueueSection[] = [];

/** Where each queue was scrolled when the person left it, so coming back from a review lands in the same place. */
const scrolled: Record<QueueScope, number> = { live: 0, sample: 0 };

/**
 * The least of the page that sits above the first row, in CSS px: the top
 * bar, the column's padding, a one-line headline and the first section's head.
 */
const ABOVE_LIST_PX = 190;

/**
 * A list that arrives behind the skeleton and is shorter than this draws
 * whole in its first commit, so it never fills in steps. That render runs at
 * deferred priority, in slices (see {@link useView}): at 4x CPU in dev, 38
 * rows committed in about 31ms against 20ms for the first screen's 10. A list
 * the page mounts with renders in one task, where 15 more rows cost about
 * 125ms in dev, so it still draws the first screen first.
 */
const WHOLE_ROWS = 40;

interface ViewInput {
	status: ReturnType<typeof useQueue.getState>['status'];
	/** True when the store holds this route's queue (the sample and the live queue share one store). */
	fresh: boolean;
	gate: SetupGate;
	/** How the page last said the first load failed, until the gate settles after the server answers. */
	wasDown: Down | null;
}

/**
 * What the page shows. The skeleton holds it until the store holds this
 * route's queue, and while the setup gate is still checking, since first run
 * may take the page, unless a list is already there (saved from the last
 * visit, or seen this session). Once the page said the server was down, that
 * notice stays (reconnecting) until the gate settles, so the page never
 * blanks between the notice and what replaces it.
 */
function viewOf({ status, fresh, gate, wasDown }: ViewInput): View {
	if (!fresh) return 'loading';
	if (status === 'offline' || status === 'failed') return status;
	if (gate === 'checking' && wasDown) return 'reconnecting';
	if (gate === 'checking' && status !== 'ready') return 'checking';

	return status;
}

/**
 * True from the page's first render, when the app takes over a full page
 * load, until a task later. Meanwhile the page keeps the skeleton the boot
 * frame painted, so a list the last visit saved draws in a task of its own
 * instead of adding to the long task that hydrates the page.
 */
function useBootSwap(): boolean {
	const [boot, setBoot] = useState(beforeMount);

	useLayoutEffect(() => {
		if (!boot) return;

		const timer = setTimeout(() => setBoot(false), 0);

		return () => clearTimeout(timer);
	}, [boot]);

	return boot;
}

/**
 * The page's view (see {@link viewOf}), and how the first load failed, for
 * the notice. The view the body mounts with draws at once (a deferred value
 * starts as the value itself): a list already there, saved from the last
 * visit or seen this session, paints whole in one task. A later view draws
 * at deferred priority, so a list that arrives from the server builds in
 * slices while the skeleton stays, where a store change would otherwise
 * render in one long task (zustand renders it at once). Deferring the first
 * view too let the page's other start-up work cut in, so a saved list
 * sometimes landed late: up to about 370ms later at 4x CPU, and past the
 * skeleton's hold at 1x.
 */
function useView(sample: boolean, gate: SetupGate): { view: View; down: Down } {
	const status = useQueue((state) => state.status);
	const fresh = useQueue((state) => state.sample === sample);
	const [wasDown, setWasDown] = useState<Down | null>(null);
	const down = status === 'offline' || status === 'failed' ? status : null;

	if (down && wasDown !== down) setWasDown(down);
	if (!down && gate !== 'checking' && wasDown) setWasDown(null);

	return { view: useDeferredValue(viewOf({ status, fresh, gate, wasDown })), down: down ?? wasDown ?? 'offline' };
}

/**
 * Puts the list back where the person left it once it shows, before it
 * paints: the same scroll, and focus on the selected row. Then it keeps
 * track of where they scroll. A list left at the top is not scrolled: its
 * new viewport already sits there, and setting the scroll would make the
 * browser lay out the whole page inside the commit that first draws it.
 */
function useReturnPlace(sample: boolean, ready: boolean) {
	const viewport = useRef<HTMLDivElement>(null);
	const scope: QueueScope = sample ? 'sample' : 'live';

	useLayoutEffect(() => {
		const element = viewport.current;

		if (!element || !ready) return;

		if (scrolled[scope] > 0) element.scrollTop = scrolled[scope];

		focusSelected();

		const save = () => {
			scrolled[scope] = element.scrollTop;
		};

		element.addEventListener('scroll', save, { passive: true });

		return () => element.removeEventListener('scroll', save);
	}, [scope, ready]);

	return viewport;
}

/** What assistive tech hears when j or k selects a row. */
function describe(entry: QueueEntry): string {
	const status = entryStatus(entry)?.label ?? 'Reviewing';

	return `${pullTitle(entry.pull.title, entry.pull.number)}, ${entry.repo} #${entry.pull.number}, ${status}`;
}

/**
 * The rows the list draws in its first commit: all of a short list that
 * arrived behind the skeleton (see {@link WHOLE_ROWS}); else enough to fill
 * the window below the headline from where the list will be scrolled to, and
 * the selected row, so the list paints whole there and focus can land on it.
 * CSS px grow with the root font on large screens, so fewer rows fit there.
 */
function firstScreenRows(scope: QueueScope, ordered: QueueEntry[], arrived: boolean): number | undefined {
	if (arrived && ordered.length < WHOLE_ROWS) return undefined;

	const selected = useQueue.getState().selected;
	const scale = rootScale();
	const visible = Math.ceil((scrolled[scope] + window.innerHeight - ABOVE_LIST_PX * scale) / (ROW_HEIGHT * scale));

	return Math.max(visible, ordered.findIndex((entry) => entry.key === selected) + 1);
}

/**
 * Measures the live list's headline and notes as they show, for the next
 * load's skeleton (`keepMeasure`): the headline's lines, and the notes'
 * count and height while they are open, in CSS px (as at the root font's
 * 16px), so a height measured at one root font size holds at another.
 */
function measureTop(): void {
	const brief = document.querySelector<HTMLElement>('.queue-column > .queue-brief');
	const text = brief?.querySelector<HTMLElement>('[data-ui="brief"]');

	if (!brief || !text) return;

	const notes = document.querySelector<HTMLElement>('.queue-column > .queue-notes[data-state="open"]');
	const shown = notes?.querySelectorAll('[data-ui="status-notice"]').length ?? 0;
	const list = notes?.querySelector<HTMLElement>('.queue-notes-list');

	keepMeasure({
		brief: Math.round(brief.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight)),
		notes: shown,
		notesHeight: (list?.getBoundingClientRect().height ?? 0) / rootScale()
	});
}

/**
 * Once the page is idle after the live list draws, and after its sections
 * or notes change, measures its headline and notes (see {@link measureTop}),
 * so the next load's skeleton keeps their room at this window width. The
 * sample keeps nothing.
 */
function useKeepMeasure(sections: QueueSection[], sample: boolean): void {
	const missing = useQueue((state) => state.missing);

	useEffect(() => {
		if (sample) return;

		return whenIdle(measureTop, 1000);
	}, [sections, missing, sample]);
}

interface SelectionProps {
	ordered: QueueEntry[];
	sample: boolean;
	onDelete: (entry: QueueEntry) => void;
}

/**
 * What assistive tech hears as j and k move, and the palette's rows. It
 * alone follows the selection, so a j press re-renders it and the two rows
 * it moves between, and not the headline, notes and list around them.
 */
function SelectionStatus({ ordered, sample, onDelete }: SelectionProps) {
	const selected = useQueueSelection(ordered, sample, onDelete);

	return (
		<p role="status" className="sr-only">
			{selected ? describe(selected) : ''}
		</p>
	);
}

/** Which repositories' lists did not load: all of them, some, or none. */
function unloadedOf(missing: number, tracked: number): Unloaded {
	if (missing === 0) return null;

	return missing >= tracked ? 'all' : 'some';
}

interface ReadyProps {
	sections: QueueSection[];
	sample: boolean;
	/** True when the list replaced the skeleton or a notice, so it renders at deferred priority (see {@link useArrived}). */
	arrived: boolean;
}

/** The ready queue: the headline, any notes, then each section's rows, and the question a delete asks. */
function QueueReady({ sections, sample, arrived }: ReadyProps) {
	const ordered = useMemo(() => sections.flatMap((section) => section.entries), [sections]);
	const [firstRows] = useState(() => firstScreenRows(sample ? 'sample' : 'live', ordered, arrived));
	const [deleting, setDeleting] = useState<DeleteTarget | null>(null);

	useKeepMeasure(sections, sample);

	const onDelete = useCallback((entry: QueueEntry) => {
		if (entry.review) setDeleting({ id: entry.review.id, running: entry.state === 'reviewing' });
	}, []);

	const controls = useQueueControls(ordered, sample);
	const lists = useQueue((state) => unloadedOf(state.missing.length, state.tracked));
	const unloaded = sections.length === 0 ? lists : null;

	return (
		<>
			<QueueHeadline sections={sections} unloaded={unloaded} />
			<QueueNotes />
			<SelectionStatus ordered={ordered} sample={sample} onDelete={onDelete} />
			{unloaded ? null : sections.length === 0 ? (
				<NoPullsActions />
			) : (
				<QueueList
					sections={sections}
					sample={sample}
					firstRows={firstRows}
					onOpen={controls.open}
					onStart={controls.start}
					onDelete={onDelete}
				/>
			)}
			<DeleteReviewDialog
				target={deleting}
				onClose={() => setDeleting(null)}
				onDeleted={(id) => useShell.getState().closeTabs([id])}
			/>
		</>
	);
}

/**
 * Whether the body showed something before the list (the skeleton, a
 * notice): the list then mounts in the deferred render a later view gets
 * (see {@link useView}), not in the body's first render.
 */
function useArrived(view: View): boolean {
	const [arrived, setArrived] = useState(view !== 'ready');

	if (view !== 'ready' && !arrived) setArrived(true);

	return arrived;
}

/**
 * What the page shows once the app has taken over: a notice, the skeleton or
 * the list, by its view. Its `queue-page` class marks rows drawn on the
 * queue's own page, as against the site's demo of them.
 */
function QueueBody({ sample, gate }: { sample: boolean; gate: SetupGate }) {
	const { view, down } = useView(sample, gate);
	const arrived = useArrived(view);
	const entries = useQueue((state) => state.entries);
	const sections = useMemo(() => (view === 'ready' ? queueSections(entries) : NO_SECTIONS), [view, entries]);
	const viewport = useReturnPlace(sample, view === 'ready');
	const shape = useSkeletonShape();

	return (
		<ScrollArea className="queue-page min-h-0 flex-1" viewportRef={viewport}>
			{view === 'offline' || view === 'failed' || view === 'reconnecting' ? (
				<DownNotice status={down} reconnecting={view === 'reconnecting'} />
			) : view === 'empty' ? (
				<EmptyNotice />
			) : (
				<div className="queue-column">
					{view === 'ready' ? (
						<QueueReady sections={sections} sample={sample} arrived={arrived} />
					) : (
						<QueueSkeleton {...shape} />
					)}
				</div>
			)}
		</ScrollArea>
	);
}

/**
 * The queue for one route, loaded on mount and kept fresh while it is open.
 * It loads in the commit that first draws the page. On a full load it keeps
 * the boot frame's skeleton for a task (see {@link useBootSwap}) and then
 * draws its body, so a list the last visit saved replaces the skeleton while
 * the skeleton is still in its hold.
 */
function QueueScreen({ sample, gate }: { sample: boolean; gate: SetupGate }) {
	const boot = useBootSwap();

	useLayoutEffect(() => useQueue.getState().load(sample), [sample]);

	return boot ? <QueueLoading /> : <QueueBody sample={sample} gate={gate} />;
}

/** The live queue waits on first run: until a provider, a model and a repository exist, first run takes the page. */
function LiveQueue() {
	const gate = useSetupGate();

	if (gate === 'needed') return <FirstRun />;

	return <QueueScreen sample={false} gate={gate} />;
}

/** The queue: open pull requests grouped by what they need from you. The sample skips first run. */
export function QueuePage({ sample }: { sample: boolean }) {
	return sample ? <QueueScreen sample gate="done" /> : <LiveQueue />;
}
