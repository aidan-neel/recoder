'use client';

import { emptyReviewProgress, type ReviewProgress } from '@recoder/shared';
import { useMemo, useState } from 'react';

import { createMemory, remember, studioView, type StudioMemory, type StudioView } from './studio-view';

/** The memory kept for review `id`, made on first use; another review's is let go. */
function memoryOf(memories: Map<string, StudioMemory>, id: string): StudioMemory {
	const kept = memories.get(id);

	if (kept) return kept;

	const fresh = createMemory();

	memories.clear();
	memories.set(id, fresh);

	return fresh;
}

/**
 * Studio's view of a review's progress, an empty office until the progress
 * arrives. It remembers what the stream lets go of (diff reads, files read and
 * verifier calls past the newest 300) for as long as the same review shows,
 * and starts over for another one.
 */
export function useStudio(progress: ReviewProgress | null): StudioView {
	const [memories] = useState(() => new Map<string, StudioMemory>());

	return useMemo(() => {
		const live = progress ?? emptyReviewProgress('');
		const memory = memoryOf(memories, live.id);

		remember(memory, live.toolCalls ?? []);

		return studioView(live, memory);
	}, [progress, memories]);
}

/** How far into the review `at` fell, as minutes and seconds: `2:07`. */
export function clockAt(at: string, startedAt: string | null): string {
	const seconds = Math.max(0, Math.floor((Date.parse(at) - Date.parse(startedAt ?? at)) / 1000));

	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
