'use client';

import type { FailureAction, ModelFailure, Review, ReviewProgress } from '@recoder/shared';
import { useMemo } from 'react';

import { modelLabel } from '../bugs/bug-lists';
import { isReviewing } from '../pulls/pull-rows';
import { useSession, useSessionData } from '../pull/pull-session';
import { runActivity } from './run-activity';
import { runPhase } from './run-phase';
import { runStages } from './run-stages';
import { waitingReason } from './run-waiting';
import type { RunPhase, RunView } from './types';

function failureAction(failure: ModelFailure | undefined): FailureAction | null {
	return failure?.usageLimit ? 'settings' : null;
}

/** Why a failed review stopped, and the way out; null unless it failed. */
function failureOf(review: Review | null, progress: ReviewProgress | null, phase: RunPhase): RunView['failure'] {
	if (phase !== 'failed') return null;

	return {
		message: progress?.failure?.reason ?? review?.summary ?? 'The review stopped before it finished.',
		action: failureAction(progress?.failure)
	};
}

/** The review of the pull request while it runs, and the controls that start and stop it. */
export function useRunView(): RunView {
	const session = useSession();
	const review = useSessionData((data) => data.review);
	const progress = useSessionData((data) => data.progress);
	const connection = useSessionData((data) => data.connection);
	const starting = useSessionData((data) => data.starting);
	const head = useSessionData((data) => data.page.value?.pull.headSha ?? null);
	const actions = session.review;

	return useMemo(() => {
		const phase = runPhase(review, progress);
		const live = phase === 'queued' || phase === 'running' || phase === 'paused';
		const sha = phase === 'none' ? null : (review?.headSha ?? null);

		return {
			phase,
			reviewId: phase === 'none' ? null : (review?.id ?? null),
			headSha: sha,
			outdated: !!sha && !!head && sha !== 'unknown' && sha !== head,
			startedAt: phase === 'none' ? null : (review?.startedAt ?? review?.createdAt ?? null),
			finishedAt: review && !isReviewing(review) && phase !== 'none' ? review.updatedAt : null,
			stages: runStages(progress, review?.status ?? 'draft', phase),
			activity: live ? runActivity(progress) : null,
			waiting: phase === 'queued' ? waitingReason(progress) : null,
			modelLabel: modelLabel(progress?.orchestratorModel),
			failure: failureOf(review, progress, phase),
			connection,
			start: actions.start,
			starting,
			cancel: actions.cancel,
			pause: actions.pause,
			resume: actions.resume,
			retry: actions.retry
		};
	}, [review, progress, connection, starting, head, actions]);
}
