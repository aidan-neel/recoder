'use client';

import { ScrollArea } from '@recoder/ui';
import { LayoutGroup } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { FirstRun } from '@/components/setup/first-run';
import { entryStatus, queueSections, type QueueEntry, type QueueSection } from '@/lib/queue/queue';
import { useQueue } from '@/lib/queue/queue-store';
import { useSetupGate, type SetupGate } from '@/lib/setup/setup-gate';
import { pullTitle } from '@/lib/shell/format';
import { useShell, type QueueScope } from '@/lib/shell/shell-store';

import { DeleteReviewDialog, type DeleteTarget } from './delete-review-dialog';
import { QueueHeadline } from './queue-headline';
import { QueueList } from './queue-list';
import { EmptyNotice, NoPullsActions, OfflineNotice, StaleNote } from './queue-notices';
import { QueueSkeleton } from './queue-skeleton';
import { useQueueControls } from './use-queue-controls';

/**
 * `checking`: first run may still take the page, so nothing paints yet.
 * `reconnecting`: the server answered after the offline notice, and the
 * settings load again before first run or the queue can take the page.
 */
type View = 'checking' | 'loading' | 'ready' | 'offline' | 'reconnecting' | 'empty';

const NO_SECTIONS: QueueSection[] = [];

/** Where each queue was scrolled when the person left it, so coming back from a review lands in the same place. */
const scrolled: Record<QueueScope, number> = { live: 0, sample: 0 };

/**
 * What the page shows. It holds the skeleton until the store holds this
 * route's queue (the sample and the live queue share one store). While first
 * run is still checking it paints nothing, since the checklist may take the
 * page instead, unless the person is coming back to a list they have seen.
 * Once the offline notice showed, it stays (reconnecting) until the gate
 * settles, so the page never blanks between the notice and what replaces it.
 */
function useView(sample: boolean, gate: SetupGate): View {
	const status = useQueue((state) => state.status);
	const fresh = useQueue((state) => state.sample === sample);
	const [wasOffline, setWasOffline] = useState(false);

	const [returning] = useState(() => {
		const state = useQueue.getState();

		return state.status === 'ready' && state.sample === sample;
	});

	if (status === 'offline' && !wasOffline) setWasOffline(true);
	if (status !== 'offline' && gate !== 'checking' && wasOffline) setWasOffline(false);

	if (status === 'offline') return 'offline';
	if (gate === 'checking' && wasOffline) return 'reconnecting';
	if (gate === 'checking' && !returning) return 'checking';
	if (!fresh || status === 'loading') return 'loading';

	return status;
}

/** Puts the list back where the person left it once it shows, and keeps track of where they scroll. */
function useScrollMemory(sample: boolean, ready: boolean) {
	const viewport = useRef<HTMLDivElement>(null);
	const scope: QueueScope = sample ? 'sample' : 'live';

	useLayoutEffect(() => {
		const element = viewport.current;

		if (!element || !ready) return;

		element.scrollTop = scrolled[scope];

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

/** The ready queue: the headline, then each section's rows, and the question a delete asks. */
function QueueReady({ sections, sample }: { sections: QueueSection[]; sample: boolean }) {
	const ordered = useMemo(() => sections.flatMap((section) => section.entries), [sections]);
	const [deleting, setDeleting] = useState<DeleteTarget | null>(null);

	const onDelete = useCallback((entry: QueueEntry) => {
		if (entry.review) setDeleting({ id: entry.review.id, running: entry.state === 'reviewing' });
	}, []);

	const controls = useQueueControls(ordered, sample, onDelete);

	return (
		<LayoutGroup>
			<QueueHeadline sections={sections} />
			<p role="status" className="sr-only">
				{controls.selected ? describe(controls.selected) : ''}
			</p>
			{sections.length === 0 ? (
				<NoPullsActions />
			) : (
				<QueueList
					sections={sections}
					sample={sample}
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
		</LayoutGroup>
	);
}

/** The queue for one route, loaded on mount and kept fresh while it is open. */
function QueueScreen({ sample, gate }: { sample: boolean; gate: SetupGate }) {
	const view = useView(sample, gate);
	const entries = useQueue((state) => state.entries);
	const sections = useMemo(() => (view === 'ready' ? queueSections(entries) : NO_SECTIONS), [view, entries]);
	const viewport = useScrollMemory(sample, view === 'ready');

	useEffect(() => useQueue.getState().load(sample), [sample]);

	return (
		<ScrollArea className="min-h-0 flex-1" viewportRef={viewport}>
			{view === 'checking' ? null : view === 'offline' || view === 'reconnecting' ? (
				<OfflineNotice reconnecting={view === 'reconnecting'} />
			) : view === 'empty' ? (
				<EmptyNotice />
			) : (
				<div className="queue-column">
					{view === 'ready' ? (
						<>
							<StaleNote />
							<QueueReady sections={sections} sample={sample} />
						</>
					) : (
						<QueueSkeleton />
					)}
				</div>
			)}
		</ScrollArea>
	);
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
