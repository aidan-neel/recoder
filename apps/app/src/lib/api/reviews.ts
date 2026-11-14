import type {
	CreateReviewInput,
	DismissalReason,
	Finding,
	FindingDecision,
	Repo,
	Review,
	ReviewListItem
} from '@recoder/shared';

import { del, post, put, request, seg } from './http';

/** What a person decides about a finding: they accept it, or set it aside for a reason. */
export type DecisionInput =
	{ state: 'accepted'; note?: string } | { state: 'dismissed'; reason: DismissalReason; note?: string };

function reviewPath(id: string): string {
	return `/api/reviews/${seg(id)}`;
}

function findingPath(id: string, findingId: string): string {
	return `${reviewPath(id)}/findings/${seg(findingId)}`;
}

/** True for a finding nobody decided on yet whose topic feedback has not quieted. */
export function isOpenFinding(finding: Pick<Finding, 'decision' | 'topic'>): boolean {
	return !finding.decision && !finding.topic?.quieted;
}

/** Repositories, the review lifecycle and what a person does with a review's findings. */
export const reviewsApi = {
	repos: () => request<Repo[]>('/api/repos'),

	/** Every review, cut down to what a list reads. */
	list: () => request<ReviewListItem[]>('/api/reviews?view=summary'),
	review: (id: string) => request<Review>(reviewPath(id)),

	/** Queues a review, or with `start: false` opens a draft session to talk the change through. */
	create: (input: CreateReviewInput) => post<Review>('/api/reviews', input),

	/** Runs the full review of a draft session. */
	startDraft: (id: string) => post<Review>(`${reviewPath(id)}/start`),

	/** Resumes a failed review from its last checkpoint. */
	continue: (id: string) => post<Review>(`${reviewPath(id)}/continue`),
	pause: (id: string) => post<{ paused: boolean }>(`${reviewPath(id)}/pause`),
	resume: (id: string) => post<{ paused: boolean }>(`${reviewPath(id)}/resume`),
	cancel: (id: string) => post<{ cancelled: boolean }>(`${reviewPath(id)}/cancel`),

	/** Removes the review with its findings, conversation and files. It cannot be undone. */
	delete: (id: string) => del<{ deleted: true }>(reviewPath(id)),

	decide: (id: string, findingId: string, input: DecisionInput) =>
		put<FindingDecision>(`${findingPath(id, findingId)}/decision`, input),
	reopen: (id: string, findingId: string) => del<{ reopened: true }>(`${findingPath(id, findingId)}/decision`),

	/** Counts that the finding helped; `unmarkUseful` takes it back. */
	markUseful: (id: string, findingId: string) =>
		put<{ useful: boolean }>(`${reviewPath(id)}/useful/${seg(findingId)}`, {}),
	unmarkUseful: (id: string, findingId: string) =>
		del<{ removed: boolean }>(`${reviewPath(id)}/useful/${seg(findingId)}`),

	/** Turns a quieted topic back on for the repository, so its findings count again. */
	unquiet: (id: string, topicId: string) => del<{ unquieted: string[] }>(`${reviewPath(id)}/quieted/${seg(topicId)}`),

	/** Posts one finding on its diff line, or updates the comment it already has. */
	postFinding: (id: string, findingId: string) => post<Review>(`${findingPath(id, findingId)}/pull-comment`),

	/**
	 * Submits the finished review's verified findings as one forge review: a
	 * summary, inline comments and the commit status. Answers the review as it
	 * then stands; a second call posts nothing twice and answers the review.
	 */
	postFindings: (id: string) => post<Review>(`${reviewPath(id)}/findings-review`)
};
