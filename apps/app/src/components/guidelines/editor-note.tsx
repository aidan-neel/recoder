'use client';

import type { RepoGuidelines } from '@recoder/shared';
import { swapMotion, useMotionVariants } from '@recoder/ui';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import type { ReactNode } from 'react';

interface EditorNoteProps {
	/** Why the last save or draft failed. */
	error: string | null;
	/** Characters in the editor (or in the draft while it streams), trimmed. */
	length: number;
	/** The character limit. */
	max: number;
	repo: RepoGuidelines | null;
}

interface Note {
	key: string;
	tone: 'danger' | 'muted';
	body: ReactNode;
}

/** What a repository save does, or why it can't run yet. */
function repoNote(repo: RepoGuidelines): Note {
	if (!repo.canPropose) {
		return {
			key: 'blocked',
			tone: 'muted',
			body: (
				<>
					Connect a token with write access in{' '}
					<Link href="/settings/connections" className="guidelines-link">
						Connections
					</Link>{' '}
					to open a pull request.
				</>
			)
		};
	}

	if (repo.pending) {
		return {
			key: 'pending',
			tone: 'muted',
			body: `Updates #${repo.pending.number}. Reviews follow ${repo.path} once it merges.`
		};
	}

	return { key: 'propose', tone: 'muted', body: `Reviews follow ${repo.path} once the pull request merges.` };
}

/** The one note the editor shows, most pressing first: a failure, the limit, then what saving does. */
function noteFor({ error, length, max, repo }: EditorNoteProps): Note | null {
	if (error) return { key: `error:${error}`, tone: 'danger', body: error };

	if (length > max) {
		return {
			key: 'over',
			tone: 'danger',
			body: `Guidelines are limited to ${max.toLocaleString('en-US')} characters.`
		};
	}

	return repo ? repoNote(repo) : null;
}

/**
 * The line between the text and the bar: a note on the left (a failure, the
 * limit, or what saving does), the character count on the right. A new note
 * crossfades in place of the old, and a failure is announced.
 */
export function EditorNote(props: EditorNoteProps) {
	const swap = useMotionVariants(swapMotion);
	const note = noteFor(props);

	return (
		<div data-ui="guidelines-meta" className="guidelines-meta">
			<AnimatePresence initial={false} mode="wait">
				{note ? (
					<motion.p
						key={note.key}
						role={note.tone === 'danger' ? 'alert' : undefined}
						data-tone={note.tone}
						className="guidelines-note"
						variants={swap}
						initial="initial"
						animate="animate"
						exit="exit"
					>
						{note.body}
					</motion.p>
				) : null}
			</AnimatePresence>
			<span className="guidelines-count" data-over={props.length > props.max || undefined}>
				{props.length.toLocaleString('en-US')} / {props.max.toLocaleString('en-US')}
			</span>
		</div>
	);
}
