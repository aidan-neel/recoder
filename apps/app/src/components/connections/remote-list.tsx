'use client';

import type { RemoteRepo } from '@recoder/shared';
import {
	Button,
	ForgeMark,
	Pill,
	ScrollArea,
	SkeletonRows,
	StatusNotice,
	swapMotion,
	useMotionVariants
} from '@recoder/ui';
import { Check, TriangleAlert } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import type { Forge } from '@/lib/api/connections';
import { OFFLINE_TEXT } from '@/lib/api/http';
import { FORGES, forgeLabel } from '@/lib/connections/forges';
import {
	useTrackRepo,
	type RemoteListView,
	type RemoteNoteView,
	type RemoteRowView
} from '@/lib/connections/use-remote-list';

/** How many rows the list's frame holds, so its skeleton fills the frame. */
const FRAME_ROWS = 7;

/** A row's height in px, the same in `connections.css`. */
const ROW_HEIGHT = 40;

/** The name bar's width for each skeleton row, cycled; the second width is unused on a one-line row. */
const SKELETON_WIDTHS = [
	['44%', '0'],
	['30%', '0'],
	['52%', '0'],
	['36%', '0']
] as const;

/** Rows of shimmer where the list will land. */
function RemoteSkeleton() {
	return (
		<SkeletonRows
			count={FRAME_ROWS}
			height={ROW_HEIGHT}
			glyph
			lines={1}
			widths={SKELETON_WIDTHS}
			rowClassName="remote-row"
		/>
	);
}

/** Track, which gives way to "Tracked" once the server has the repository. A refusal raises a toast. */
function TrackButton({ repo }: { repo: RemoteRepo }) {
	const { status, track } = useTrackRepo();

	return (
		<Button
			variant="outline"
			status={status}
			successLabel={null}
			errorLabel={null}
			aria-label={`Track ${repo.name}`}
			onClick={() => void track(repo)}
		>
			Track
		</Button>
	);
}

/** A row's right end: Track, or "Tracked" in its place. The two swap with the kit's crossfade. */
function RowEnd({ repo, tracked }: RemoteRowView) {
	const swap = useMotionVariants(swapMotion);

	return (
		<span className="remote-end">
			<AnimatePresence initial={false} mode="popLayout">
				{tracked ? (
					<motion.span
						key="tracked"
						className="remote-tracked"
						variants={swap}
						initial="initial"
						animate="animate"
						exit="exit"
					>
						<Check aria-hidden />
						Tracked
					</motion.span>
				) : (
					<motion.span key="track" variants={swap} initial="initial" animate="animate" exit="exit">
						<TrackButton repo={repo} />
					</motion.span>
				)}
			</AnimatePresence>
		</span>
	);
}

/** One repository the forge can see. */
function RemoteRow({ repo, tracked }: RemoteRowView) {
	return (
		<li className="remote-row">
			<ForgeMark provider={repo.provider} />
			<span className="remote-name" title={repo.name}>
				{repo.name}
			</span>
			{repo.isPrivate ? <Pill>Private</Pill> : null}
			<RowEnd repo={repo} tracked={tracked} />
		</li>
	);
}

/** Above the rows that did load: the forge whose list failed, why, and a way to list it again. */
function FailedNote({ note }: { note: RemoteNoteView }) {
	return (
		<div className="strip remote-note" role="status">
			<TriangleAlert aria-hidden />
			<span className="strip-text">
				<strong>{forgeLabel(note.forge)}</strong> repositories did not load. {note.error}
			</span>
			<Button variant="quiet" status={note.retrying ? 'pending' : 'idle'} onClick={note.retry}>
				Try again
			</Button>
		</div>
	);
}

interface RemoteRowsProps {
	rows: RemoteRowView[];
	notes: RemoteNoteView[];
}

/** The repositories that loaded, under a note for each forge whose list did not. */
function RemoteRows({ rows, notes }: RemoteRowsProps) {
	return (
		<ScrollArea className="remote-scroll">
			{notes.map((note) => (
				<FailedNote key={note.forge} note={note} />
			))}
			<ul className="remote-list" aria-label="Repositories">
				{rows.map((row) => (
					<RemoteRow key={row.repo.url} repo={row.repo} tracked={row.tracked} />
				))}
			</ul>
		</ScrollArea>
	);
}

/** No forge is signed in: a Connect button for each, which opens the token dialog. */
function NoForge({ onConnect }: { onConnect: (forge: Forge) => void }) {
	return (
		<StatusNotice
			title="No forge is connected"
			detail="Connect one to list its repositories, or add a repository by URL."
			actions={FORGES.map((forge) => (
				<Button key={forge.id} variant="outline" onClick={() => onConnect(forge.id)}>
					<ForgeMark provider={forge.id} />
					Connect {forge.label}
				</Button>
			))}
		/>
	);
}

/** What the list says when no repository is left to show. */
function NoMatch({ query }: { query: string }) {
	if (query) {
		return <StatusNotice title={`No repository matches “${query}”`} detail="Check the name, or add it by URL." />;
	}

	return <StatusNotice title="This account has no repositories" detail="Add one by URL." />;
}

interface RemoteListProps {
	view: RemoteListView;
	/** Opens the token dialog, for the notice shown while no forge is signed in. */
	onConnect: (forge: Forge) => void;
}

/**
 * What the repository browser lists: the repositories the signed-in forges
 * can see, tracked ones marked. Its frame keeps one height, so loading and
 * searching never resize the dialog.
 */
export function RemoteList({ view, onConnect }: RemoteListProps) {
	switch (view.kind) {
		case 'checking':
		case 'loading':
			return <RemoteSkeleton />;
		case 'no-forge':
			return <NoForge onConnect={onConnect} />;
		case 'empty':
			return <NoMatch query={view.query} />;
		case 'ready':
			return <RemoteRows rows={view.rows} notes={view.notes} />;
		case 'auth-error':
			return (
				<StatusNotice
					title={view.error ? 'Forges did not load' : OFFLINE_TEXT}
					detail={view.error ?? 'Start it, then try again.'}
					actions={
						<Button variant="outline" status={view.retry.status} onClick={view.retry.run}>
							Try again
						</Button>
					}
				/>
			);
		case 'failed':
			return (
				<StatusNotice
					title="Repositories did not load"
					detail={view.error}
					actions={
						<Button variant="outline" status={view.retrying ? 'pending' : 'idle'} onClick={view.retry}>
							Try again
						</Button>
					}
				/>
			);
	}
}
