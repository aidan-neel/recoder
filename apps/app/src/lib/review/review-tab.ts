import { useShell } from '../shell/shell-store';
import { stateOf } from './decisions';
import { isRunning, surfaceOf, type ReviewData } from './review-state';

/**
 * Mirrors the review into its top-bar tab; `seen` marks it as the most
 * recently opened. What the page does not know yet (the repository before
 * the lookups answer) keeps what the tab already shows.
 */
export function syncTab(state: ReviewData, seen = false): void {
	const { review, repoName, records, pull } = state;

	if (!review) return;

	const surface = surfaceOf(state);
	const open = surface?.decisions.filter((decision) => stateOf(records, decision.id) === 'open') ?? [];
	const known = useShell.getState().tabs.find((tab) => tab.id === review.id);

	useShell.getState().openTab(
		{
			id: review.id,
			repo: repoName ?? known?.repo ?? 'review',
			pr: review.prNumber,
			title: review.prTitle ?? known?.title ?? `#${review.prNumber}`,
			url: pull?.url ?? review.prUrl ?? known?.url ?? null,
			open: isRunning(review) ? null : open.length,
			high: open.some((decision) => decision.tone === 'high')
		},
		seen
	);
}
