'use client';

import { IMAGE_TYPES } from '@recoder/shared';
import { ComposerTool } from '@recoder/ui';
import { Paperclip } from 'lucide-react';
import { useRef, type ChangeEvent } from 'react';

/** The file chooser's filter: the image types Recoder accepts. */
const ACCEPT = IMAGE_TYPES.join(',');

/**
 * The composer's image tool: it opens the system's file chooser for images
 * and hands what was chosen to `onAttach`. Pasting or dropping an image on
 * the composer does the same.
 */
export function AttachImages({ onAttach, disabled }: { onAttach: (files: File[]) => void; disabled?: boolean }) {
	const input = useRef<HTMLInputElement>(null);

	/** Hands the chosen files on, then empties the chooser so the same file can be chosen again. */
	function chosen(event: ChangeEvent<HTMLInputElement>): void {
		const files = [...(event.target.files ?? [])];

		event.target.value = '';

		if (files.length > 0) onAttach(files);
	}

	return (
		<>
			<ComposerTool label="Attach images" disabled={disabled} onClick={() => input.current?.click()}>
				<Paperclip />
			</ComposerTool>
			<input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={chosen} />
		</>
	);
}
