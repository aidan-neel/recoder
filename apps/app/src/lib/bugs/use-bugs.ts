'use client';

import type { Review } from '@recoder/shared';
import { useCallback, useMemo } from 'react';

import { isReviewing } from '../pulls/pull-rows';
import { useSession, useSessionData } from '../pull/pull-session';
import { bugLists, modelLabel, type BugLists } from './bug-lists';
import { fixPrompt } from './fix-prompt';
import type { BugsView, SummaryView } from './types';

const NO_LISTS: BugLists = {
	open: [],
	decided: [],
	resolved: [],
	quieted: [],
	unresolved: [],
	checked: { claims: 0, cleared: 0 },
	reviewedAt: null,
	headSha: null,
	duration: null
};

function phaseOf(review: Review | null, load: 'none' | 'loading' | 'ready' | 'failed'): BugsView['phase'] {
	if (review?.status === 'passed') return 'ready';
	if (load === 'failed') return 'failed';
	if (load === 'loading') return 'loading';

	return 'none';
}

/** The Bugs tab: the findings of the newest finished review, and what a person can do with each. */
export function useBugsView(): BugsView {
	const session = useSession();
	const review = useSessionData((data) => data.review);
	const load = useSessionData((data) => data.reviewLoad);
	const error = useSessionData((data) => data.reviewError);
	const votes = useSessionData((data) => data.votes);
	const pending = useSessionData((data) => data.pendingBugs);
	const postingAll = useSessionData((data) => data.postingAll);
	const model = useSessionData((data) => data.progress?.orchestratorModel);
	const canPost = useSessionData((data) => data.page.value?.capabilities.comments ?? false);
	const pull = useSessionData((data) => data.page.value?.pull ?? null);
	const phase = phaseOf(review, load);

	const lists = useMemo(() => (review?.status === 'passed' ? bugLists(review, votes) : NO_LISTS), [review, votes]);

	const promptFor = useCallback(
		(id: string) => {
			const bug = [...lists.open, ...lists.decided, ...lists.quieted].find((candidate) => candidate.id === id);

			return bug ? fixPrompt(bug, pull) : '';
		},
		[lists, pull]
	);

	const actions = session.bugs;

	return useMemo(
		() => ({
			phase,
			error: phase === 'failed' ? error : null,
			...lists,
			findingsReview: review?.findingsReview
				? {
						state: review.findingsReview.state,
						url: review.findingsReview.url ?? null,
						error: review.findingsReview.error ?? null
					}
				: null,
			modelLabel: modelLabel(model),
			canPost,
			pending,
			post: actions.post,
			postAll: actions.postAll,
			postingAll,
			accept: actions.accept,
			dismiss: actions.dismiss,
			reopen: actions.reopen,
			unquiet: actions.unquiet,
			vote: actions.vote,
			fixPrompt: promptFor
		}),
		[phase, error, lists, review, model, canPost, pending, actions, postingAll, promptFor]
	);
}

/** What the Summary tab shows above the conversation. */
export function useSummaryView(): SummaryView {
	const review = useSessionData((data) => data.review);
	const description = useSessionData((data) => data.page.value?.pull.body?.trim() || null);

	return useMemo(
		() => ({
			analysis: review?.status === 'passed' ? review.summary : null,
			writing: !!review && isReviewing(review),
			description
		}),
		[review, description]
	);
}
