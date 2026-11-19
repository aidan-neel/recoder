'use client';

import { SwapText } from '@recoder/ui';
import type { ReactNode } from 'react';

import type { EditorNote as Note } from '@/lib/guidelines/editor-note';
import { formatCount } from '@/lib/shell/format';
import { openSettings } from '@/lib/settings/open-settings';

interface EditorNoteProps {
	/** What the line says, or null when there is nothing to say. */
	note: Note | null;
	/** Characters in the editor, or in the draft while it streams. */
	length: number;
	/** The character limit. */
	max: number;
}

/** A note's words. A blocked save has none of its own: it points at the page that unblocks it. */
function noteWords(note: Note): ReactNode {
	if (note.kind !== 'blocked') return note.text;

	return (
		<>
			Connect a token with write access in{' '}
			<button type="button" className="text-link" onClick={() => openSettings('connections')}>
				Connections
			</button>{' '}
			to open a pull request.
		</>
	);
}

/**
 * The line between the text and the bar: a note on the left (a failure, the
 * limit, or what saving does) and the character count on the right. A new
 * note takes the old one's place, and a failure is announced.
 */
export function EditorNote({ note, length, max }: EditorNoteProps) {
	return (
		<div className="guidelines-meta">
			<SwapText id={note?.key ?? 'none'} mode="wait" className="guidelines-note">
				{note ? (
					<span data-tone={note.tone} role={note.tone === 'danger' ? 'alert' : undefined}>
						{noteWords(note)}
					</span>
				) : null}
			</SwapText>
			<span className="guidelines-count" data-over={length > max || undefined}>
				{formatCount(length)} / {formatCount(max)}
			</span>
		</div>
	);
}
