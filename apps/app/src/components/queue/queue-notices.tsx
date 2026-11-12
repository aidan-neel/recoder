'use client';

import { Button, Collapsible, CollapsibleContent, StatusNotice } from '@recoder/ui';
import Link from 'next/link';
import { useMemo, type ComponentProps } from 'react';

import { PageNotice } from '@/components/common/page-notice';
import { OFFLINE_DETAIL, OFFLINE_TEXT } from '@/lib/api/http';
import { queueNotes, type QueueNote } from '@/lib/queue/queue-notes';
import { useQueue } from '@/lib/queue/queue-store';
import { checkSetupAgain, useSetupNote } from '@/lib/setup/setup-gate';
import { useAction } from '@/lib/shell/use-action';
import { useLastShown } from '@/lib/shell/use-last-shown';

/** Loads the queue again. A load that still fails rejects with what failed, so the button shows its failure face. */
async function reload(): Promise<void> {
	if (!(await useQueue.getState().refresh())) throw new Error(useQueue.getState().error ?? OFFLINE_TEXT);
}

/** Loads the queue again from a note; it also counts as failed while some repository's pull requests still fail. */
async function retryNote(): Promise<void> {
	await reload();

	if (useQueue.getState().missing.length > 0) throw new Error('Some pull requests still didn’t load.');
}

function SampleButton() {
	return (
		<Button asChild variant="outline">
			<Link href="/review/sample">Open the sample review</Link>
		</Button>
	);
}

interface DownNoticeProps {
	/** `offline`: the server never answered. `failed`: it answered with an error, or too late. */
	status: 'offline' | 'failed';
	/** The server answered and the setup check runs again, so Try again keeps spinning until first run or the queue takes the page. */
	reconnecting: boolean;
}

/**
 * The whole page when the first load failed and no earlier list is saved to
 * show instead. Its sentences say what failed, as the review page's do, and
 * leave trying again to the button beside them.
 */
export function DownNotice({ status, reconnecting }: DownNoticeProps) {
	const retry = useAction();
	const error = useQueue((state) => state.error);
	const offline = status === 'offline';

	return (
		<PageNotice
			lead={offline ? OFFLINE_TEXT : 'Couldn’t load the queue.'}
			rest={offline ? `${OFFLINE_DETAIL} The sample review works without it.` : error}
		>
			<Button status={reconnecting ? 'pending' : retry.status} onClick={() => retry.run(reload)}>
				Try again
			</Button>
			<SampleButton />
		</PageNotice>
	);
}

/**
 * A link to Settings > Connections, passing on what a kit `asChild` button
 * gives it. It leaves prefetching to the shell, as the tabs do: Next's
 * viewport prefetch fetched the settings page and its code, the command
 * palette's included, while the queue was still painting.
 */
function ConnectionsLink(props: Omit<ComponentProps<typeof Link>, 'href' | 'prefetch'>) {
	return <Link {...props} href="/settings/connections" prefetch={false} />;
}

/** The whole page when the server answers with no tracked repositories. */
export function EmptyNotice() {
	return (
		<PageNotice lead="No repositories tracked yet." rest="Track one in Settings and its open pull requests land here.">
			<Button asChild variant="primary">
				<ConnectionsLink>Open settings</ConnectionsLink>
			</Button>
			<SampleButton />
		</PageNotice>
	);
}

/**
 * A note's way out. Only the first note of each action in the region gets a
 * button (Try again or Open Connections), so the notes never stack the same one.
 */
function NoteAction({ note, first }: { note: QueueNote; first: boolean }) {
	const retry = useAction();

	if (!first) return null;

	if (note.action === 'connections') {
		return (
			<Button asChild variant="ghost">
				<ConnectionsLink>Open Connections</ConnectionsLink>
			</Button>
		);
	}

	return (
		<Button variant="ghost" status={retry.status} onClick={() => retry.run(retryNote)}>
			Try again
		</Button>
	);
}

/** The setup check's note: still running after the queue stopped waiting, or failed with a way to check again. */
function SetupNote({ title, detail, retry }: { title: string; detail: string | null; retry: boolean }) {
	const check = useAction();

	return (
		<StatusNotice
			variant="inline"
			title={title}
			detail={detail}
			actions={
				retry ? (
					<Button variant="ghost" status={check.status} onClick={() => check.run(checkSetupAgain)}>
						Check again
					</Button>
				) : null
			}
		/>
	);
}

/**
 * Quiet lines under the headline when the list is not all fresh: a refresh
 * that failed (with when the list is from), repositories whose pull requests
 * did not load and why, and a setup check that is slow or failed. They are
 * part of the first paint when known then; ones that come later fold open
 * and push the list down once, and fold away when fixed.
 */
export function QueueNotes() {
	const error = useQueue((state) => state.error);
	const loadedAt = useQueue((state) => state.loadedAt);
	const missing = useQueue((state) => state.missing);
	const stale = useQueue((state) => state.stale);
	const setup = useSetupNote();
	const notes = useMemo(() => queueNotes(error, loadedAt, missing, stale), [error, loadedAt, missing, stale]);
	const last = useLastShown(notes.length > 0 ? notes : null) ?? notes;
	const open = notes.length > 0 || setup !== null;
	const shown = open ? notes : last;
	const firstRetry = shown.find((note) => note.action === 'retry');
	const firstConnections = shown.find((note) => note.action === 'connections');

	return (
		<Collapsible open={open} className="queue-notes">
			<CollapsibleContent className="queue-notes-list">
				{shown.map((note) => (
					<StatusNotice
						key={note.key}
						variant="inline"
						title={note.title}
						detail={note.detail}
						actions={<NoteAction note={note} first={note === firstRetry || note === firstConnections} />}
					/>
				))}
				{setup ? <SetupNote {...setup} /> : null}
			</CollapsibleContent>
		</Collapsible>
	);
}

/** Under the headline when every tracked repository has no open pull requests. */
export function NoPullsActions() {
	return (
		<div className="flex gap-2">
			<Button asChild variant="outline">
				<ConnectionsLink>Track another repository</ConnectionsLink>
			</Button>
		</div>
	);
}
