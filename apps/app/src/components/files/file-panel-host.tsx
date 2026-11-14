'use client';

import type { ChatTrailFile } from '@recoder/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { OpenFileContext } from '@/components/chat-trail/file-reference';

import { FilePanel } from './file-panel';

interface FilePanelHostProps {
	repoId: string;
	/** The commit the chat is about: a review's head commit. A repository chat has none and reads the default branch. */
	gitRef?: string;
	children: ReactNode;
}

/** Closes the panel on Escape, unless something above it, such as a menu, already took the key. */
function useCloseOnEscape(active: boolean, close: () => void): void {
	useEffect(() => {
		if (!active) return;

		function onKeyDown(event: KeyboardEvent): void {
			if (event.key === 'Escape' && !event.defaultPrevented) close();
		}

		document.addEventListener('keydown', onKeyDown);

		return () => document.removeEventListener('keydown', onKeyDown);
	}, [active, close]);
}

/**
 * Gives the chat below it a place to open files: pressing a file chip or a citation opens the file in a panel on
 * the right, beside the chat, which stays usable. Which file is open is this component's own state, so each chat
 * page has its own panel and it closes with the page. Another reference swaps the file.
 */
export function FilePanelHost({ repoId, gitRef, children }: FilePanelHostProps) {
	const [file, setFile] = useState<ChatTrailFile | null>(null);
	const close = useCallback(() => setFile(null), []);

	/** Opens a copy, so pressing the file that is already open still brings its lines back into view. */
	const open = useCallback((reference: ChatTrailFile) => setFile({ ...reference }), []);

	useCloseOnEscape(file !== null, close);

	return (
		<OpenFileContext value={open}>
			<div className="file-host" data-open={file ? '' : undefined}>
				<div className="file-host-main">{children}</div>
				{file ? (
					<FilePanel
						key={`${repoId}@${gitRef}`}
						repoId={repoId}
						gitRef={gitRef}
						reference={file}
						onOpenFile={open}
						onClose={close}
					/>
				) : null}
			</div>
		</OpenFileContext>
	);
}
