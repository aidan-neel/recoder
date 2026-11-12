'use client';

import type { PullRequest, Review } from '@recoder/shared';
import { useShallow } from 'zustand/react/shallow';

import { forgeLabel } from '@/lib/connections/forges';
import { plain } from '@/lib/review/labels';
import { isOutdated, lifecycle, phaseOf, type ReviewPhase } from '@/lib/review/lifecycle';
import { decisionCounts, surfaceOf, useReview } from '@/lib/review/review-store';
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

/**
 * The pull request's title as one line: the review's copy, else the forge's,
 * else "Pull request". Every caller shows the number just before it, so the
 * fallback leaves the number out rather than say it twice.
 */
export function pullTitle(review: Review, pull: PullRequest | null): string {
	const title = review.prTitle || pull?.title;

	return title ? plain(title) : 'Pull request';
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

/**
 * True when a passed review's diff came back empty. The server stores the
 * diff before any reviewer starts, so a passed review always has one, and an
 * empty list means no files changed. A review that stopped may have stopped
 * before its diff was stored, and the page reads that answer (a 404) as an
 * empty list too, so it says nothing there; neither does a review still at
 * work, nor a diff that failed to load, which says so in the rail.
 */
export function useNoFiles(): boolean {
	const passed = usePhase() === 'passed';
	const empty = useReview((state) => state.files.length === 0 && state.filesError === null);

	return passed && empty;
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
