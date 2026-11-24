'use client';

import { useState } from 'react';

import { useSessionData } from '@/lib/pull/pull-session';
import { isLive } from '@/lib/run/run-phase';
import type { RunView } from '@/lib/run/types';
import { useStudio } from '@/lib/studio/use-studio';

import { Studio } from './studio';

/**
 * Whether Studio shows on the Review tab: while the review is live, and once
 * it passes for as long as the page that watched it stays open, so the ending
 * plays where it was watched. A review that finished before the page opened
 * shows its findings alone.
 */
export function useStudioShown(run: RunView): { shown: boolean; ended: boolean } {
	const [watched, setWatched] = useState<string | null>(null);
	const live = isLive(run.phase);

	if (live && run.reviewId && watched !== run.reviewId) setWatched(run.reviewId);

	const ended = run.phase === 'passed' && watched !== null && watched === run.reviewId;

	return { shown: live || ended, ended };
}

/**
 * Studio for the pull request's newest review, from the session's live progress. It shows from the first second:
 * an empty office until the pipeline's first task, then the orchestrator, then the reviewers once the plan lands.
 */
export function ReviewStudio({ run, ended }: { run: RunView; ended: boolean }) {
	const progress = useSessionData((data) => data.progress);
	const view = useStudio(progress);
	const [selected, setSelected] = useState<string | null>(null);

	return (
		<Studio
			view={view}
			calls={progress?.toolCalls ?? []}
			startedAt={run.startedAt}
			ended={ended}
			selected={selected}
			onSelect={setSelected}
		/>
	);
}
