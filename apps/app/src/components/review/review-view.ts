'use client';

import type { PullRequest, Review } from '@recoder/shared';
import { useShallow } from 'zustand/react/shallow';

import { forgeLabel } from '@/lib/connections/forges';
import { plain } from '@/lib/review/labels';
import { isOutdated, lifecycle, phaseOf, type ReviewPhase } from '@/lib/review/lifecycle';
import { decisionCounts, surfaceOf, useReview } from '@/lib/review/review-store';
import { pullTitle as titleOf } from '@/lib/shell/format';
import { useShell } from '@/lib/shell/shell-store';

/** The review's decisions, receipts and files; null until the review loads. */
export function useSurface() {
	return useReview(surfaceOf);
}

/** Decisions in each state, plus the total. */
export function useCounts() {
	return useReview(useShallow(decisionCounts));
}

/** The review the page shows. Components under the ready page only render once it has loaded. */
export function useShownReview(): Review {
	const review = useReview((state) => state.review);

	if (!review) throw new Error('The review page rendered before its review loaded.');

	return review;
}

/** Where the shown review stands. */
export function usePhase(): ReviewPhase {
	return useReview((state) => (state.review ? phaseOf(state.review, state.progress) : 'queued'));
}

/** The pull request's title as one line: the review's copy, else the forge's, else its number. */
export function pullTitle(review: Review, pull: PullRequest | null): string {
	return plain(titleOf(review.prTitle ?? pull?.title, review.prNumber));
}

/** The forge the pull request lives on ("GitHub", "GitLab"); null for a local or offline review. */
export function forgeName(review: Review): string | null {
	return review.source === 'github' || review.source === 'gitlab' ? forgeLabel(review.source) : null;
}

/** True when commits landed on the pull request after this review. */
export function useOutdated(): boolean {
	return useReview((state) => !!state.review && isOutdated(state.review, state.pull));
}

/** Phases in which the reviewers are still at work, or have not started. */
const WORKING: ReadonlySet<ReviewPhase> = new Set(['draft', 'queued', 'running', 'paused']);

/** True while the review is a draft or still running: more decisions may come. */
export function isWorking(phase: ReviewPhase): boolean {
	return WORKING.has(phase);
}

/** True while the reading pane shows live progress: the overview of a review still at work with nothing found yet. */
export function useLiveView(): boolean {
	const phase = usePhase();
	const { total } = useCounts();
	const overview = useReview((state) => state.selection.kind === 'overview');

	return overview && isWorking(phase) && total === 0;
}

/** Queues a fresh review of the pull request and opens it. */
export async function openReviewAgain(review: Review): Promise<void> {
	const fresh = await lifecycle.again(review);

	if (fresh.id !== review.id) useShell.getState().navigate(`/review/${encodeURIComponent(fresh.id)}`);
}
