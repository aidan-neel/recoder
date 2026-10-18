import type { FileDiff, PrCheck, PullPreview, PullRequest, Repo, Review, ReviewMetrics } from '@recoder/shared';

import { del, post, request, seg } from './http';

/** Task progress per review id, for rows that are still running. */
export type ProgressSummaries = Record<string, { tasksDone: number; tasksTotal: number; agents: number }>;

/** The pull request to review. Without a head commit the server reviews the current one. */
type PullTarget = Pick<PullRequest, 'number'> & Partial<Pick<PullRequest, 'headSha' | 'title'>>;

/** Repositories, pull requests and the review lifecycle. */
export const reviewsApi = {
	repos: () => request<Repo[]>('/api/repos'),
	pulls: (repoId: string) => request<PullRequest[]>(`/api/repos/${seg(repoId)}/pulls`),

	/** One pull request by number, open or not; the server answers with its preview and this keeps the PR. */
	pull: (repoId: string, number: number) =>
		request<PullPreview>(`/api/repos/${seg(repoId)}/pulls/${seg(number)}`).then((preview) => preview.pr),

	reviews: () => request<Review[]>('/api/reviews'),
	progress: () => request<ProgressSummaries>('/api/reviews/progress-summaries'),
	review: (id: string) => request<Review>(`/api/reviews/${seg(id)}`),
	files: (id: string, signal?: AbortSignal) => request<FileDiff[]>(`/api/reviews/${seg(id)}/files`, { signal }),
	checks: (id: string) => request<{ ref: string; checks: PrCheck[] }>(`/api/reviews/${seg(id)}/checks`),

	/** Token use so far, by model and stage; null before the review has made a call. */
	metrics: (id: string) => request<ReviewMetrics | null>(`/api/reviews/${seg(id)}/metrics`),

	/** Queue a full review of the pull request's current head. */
	start: (repoId: string, pull: PullTarget) =>
		post<Review>('/api/reviews', { repoId, prNumber: pull.number, headSha: pull.headSha, prTitle: pull.title }),

	/** Start a draft session: the diff loads and the orchestrator opens a conversation, no review runs yet. */
	draft: (repoId: string, pull: PullRequest) =>
		post<Review>('/api/reviews', { repoId, prNumber: pull.number, prTitle: pull.title, start: false }),

	/** Run the full review of a draft session. */
	startDraft: (id: string) => post<Review>(`/api/reviews/${seg(id)}/start`),

	/** Resume a failed review from its last checkpoint. */
	continue: (id: string) => post<Review>(`/api/reviews/${seg(id)}/continue`),
	pause: (id: string) => post<{ paused: boolean }>(`/api/reviews/${seg(id)}/pause`),
	resume: (id: string) => post<{ paused: boolean }>(`/api/reviews/${seg(id)}/resume`),
	cancel: (id: string) => post<{ cancelled: boolean }>(`/api/reviews/${seg(id)}/cancel`),
	remove: (id: string) => del<{ deleted: boolean }>(`/api/reviews/${seg(id)}`),

	/** Tell the server a finding is not an issue, so later reviews of the repo stop raising it. */
	dismiss: (id: string, findingId: string, reason: string) =>
		post<{ dismissed: boolean }>(`/api/reviews/${seg(id)}/dismissals`, { findingId, reason }),
	restore: (id: string, findingId: string) =>
		del<{ restored: boolean }>(`/api/reviews/${seg(id)}/dismissals/${seg(findingId)}`)
};
