'use client';

import type { ChatTrailFile } from '@recoder/shared';
import { createContext, use } from 'react';

/**
 * What a person pressing a file in a chat does: a file chip in the trail or a citation in the reply. This is the one
 * place file references are handled. It is null until something (the side panel) provides it, and chips stay plain
 * text meanwhile.
 */
export const OpenFileContext = createContext<((file: ChatTrailFile) => void) | null>(null);

/** The handler for pressing a file reference, or null when none is provided. */
export function useOpenFile(): ((file: ChatTrailFile) => void) | null {
	return use(OpenFileContext);
}
