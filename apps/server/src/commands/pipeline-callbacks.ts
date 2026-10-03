import type { runAdaptiveReview } from '../review/pipeline/harness';
import { discussionContext, recordChatMessage } from '../review/chat/review-chat';
import {
	emitReviewEvent,
	reportReviewAssignment,
	reportReviewCoverage,
	reportReviewPlan,
	reportReviewReasoning,
	reportReviewTask,
	reportReviewTool
} from '../review/session/events';
import { reviewCheckpoints, reviewProgress } from '../store';

type HarnessCallbacks = Parameters<typeof runAdaptiveReview>[1];

/**
 * How a running review reports back: progress and events for the page, chat
 * messages for the session, and checkpoints tagged with the revision under
 * review, so a continue can tell whether the PR moved.
 */
export function harnessCallbacks(
	reviewId: string,
	revision: { headSha: string; mergeBaseSha: string }
): HarnessCallbacks {
	const { headSha, mergeBaseSha } = revision;

	return {
		onTask: (task) => reportReviewTask(reviewId, task),
		onMessage: (message) =>
			recordChatMessage(reviewId, { ...message, from: 'assistant', at: new Date().toISOString() }),
		getDiscussion: (assignmentId) =>
			[
				discussionContext(reviewId),
				assignmentId && assignmentId !== '__pipeline' ? discussionContext(reviewId, assignmentId) : ''
			]
				.filter(Boolean)
				.join('\n\n'),
		onLog: (message, meta) =>
			emitReviewEvent(reviewId, {
				type: 'log',
				step: meta?.assignmentId ? `assignment:${meta.assignmentId}` : 'review',
				message,
				data: { agent: meta?.role, assignmentId: meta?.assignmentId }
			}),
		onPlan: (data) => reportReviewPlan(reviewId, data),
		onAssignment: (assignment) => reportReviewAssignment(reviewId, assignment),
		onCoverage: (coverage, gaps) => reportReviewCoverage(reviewId, coverage, gaps),
		onBudget: (budget) => {
			const snapshot = reviewProgress.get(reviewId);

			if (snapshot) reviewProgress.set({ ...snapshot, budget });
		},
		onReasoning: (reasoning) => reportReviewReasoning(reviewId, reasoning),
		onTool: (tool) => reportReviewTool(reviewId, tool),
		onCandidates: (count) => {
			const snapshot = reviewProgress.get(reviewId);

			if (snapshot) reviewProgress.set({ ...snapshot, candidateCount: count });

			emitReviewEvent(reviewId, {
				type: 'finding',
				message: `${count} candidate finding${count === 1 ? '' : 's'}`,
				data: { candidateCount: count }
			});
		},
		onGuidelines: (guidelines) => {
			const sources = guidelines.layers.map((layer) => (layer.source === 'global' ? 'global' : layer.path)).join(' + ');

			emitReviewEvent(reviewId, {
				type: 'step',
				step: 'review',
				message: `Following review guidelines (${sources})`,
				data: { guidelines }
			});
		},
		onStage: (stage) => {
			emitReviewEvent(reviewId, { type: 'step', step: stage, message: '', data: { stage } });
		},
		onCheckpoint: (checkpoint) => reviewCheckpoints.set({ ...checkpoint, id: reviewId, headSha, mergeBaseSha })
	};
}
