'use client';

import { useState, type ClipboardEvent, type DragEvent } from 'react';

/** What a composer wires onto its box to take files: whether some are over it, and the paste and drop handlers. */
export interface ComposerFiles {
	dropping: boolean;
	onPaste: (event: ClipboardEvent<HTMLElement>) => void;
	onDragOver: (event: DragEvent<HTMLElement>) => void;
	onDragLeave: (event: DragEvent<HTMLElement>) => void;
	onDrop: (event: DragEvent<HTMLElement>) => void;
}

/**
 * Hands files pasted into the composer, or dropped on it, to `onFiles`. A
 * paste with no files stays a text paste. Without `onFiles` the handlers do
 * nothing, so a dragged file is refused as usual.
 */
export function useComposerFiles(onFiles: ((files: File[]) => void) | undefined): ComposerFiles {
	const [dropping, setDropping] = useState(false);

	function onPaste(event: ClipboardEvent<HTMLElement>): void {
		const files = [...event.clipboardData.files];

		if (!onFiles || files.length === 0) return;

		event.preventDefault();
		onFiles(files);
	}

	function onDragOver(event: DragEvent<HTMLElement>): void {
		if (!onFiles || !event.dataTransfer.types.includes('Files')) return;

		event.preventDefault();
		event.dataTransfer.dropEffect = 'copy';
		setDropping(true);
	}

	/** Leaving for a child of the box is not leaving the box. */
	function onDragLeave(event: DragEvent<HTMLElement>): void {
		const next = event.relatedTarget;

		if (next instanceof Node && event.currentTarget.contains(next)) return;

		setDropping(false);
	}

	function onDrop(event: DragEvent<HTMLElement>): void {
		if (!onFiles) return;

		event.preventDefault();
		setDropping(false);

		const files = [...event.dataTransfer.files];

		if (files.length > 0) onFiles(files);
	}

	return { dropping, onPaste, onDragOver, onDragLeave, onDrop };
}
