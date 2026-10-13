import { env } from '$env/dynamic/public';
import type { FileDiff, ProviderAuth, PullRequest, Repo, Review } from '@recoder/shared';

const base = (env.PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

/** Live task counts per running review, keyed by review id. */
export type ProgressSummaries = Record<string, { tasksDone: number; tasksTotal: number }>;

/** The server answered, but not with what was asked for. */
export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
		this.name = 'ApiError';
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${base}${path}`, {
		...init,
		headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers
	});

	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as { error?: string } | null;

		throw new ApiError(body?.error ?? `${response.status} ${response.statusText}`, response.status);
	}

	return (await response.json()) as T;
}

function post<T>(path: string, body: unknown = {}): Promise<T> {
	return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

/** The Recoder server's endpoints this app reads and writes. */
export const api = {
	repos: () => request<Repo[]>('/api/repos'),
	pulls: (repoId: string) => request<PullRequest[]>(`/api/repos/${repoId}/pulls`),
	reviews: () => request<Review[]>('/api/reviews'),
	progress: () => request<ProgressSummaries>('/api/reviews/progress-summaries'),
	review: (id: string) => request<Review>(`/api/reviews/${id}`),
	files: (id: string) => request<FileDiff[]>(`/api/reviews/${id}/files`),
	auth: () => request<{ github: ProviderAuth; gitlab: ProviderAuth }>('/api/auth/status'),
	startReview: (repoId: string, pull: PullRequest) =>
		post<Review>('/api/reviews', { repoId, prNumber: pull.number, headSha: pull.headSha, prTitle: pull.title }),
	retryReview: (id: string) => post<Review>(`/api/reviews/${id}/continue`),
	dismiss: (id: string, findingId: string, reason: string) =>
		post<{ dismissed: boolean }>(`/api/reviews/${id}/dismissals`, { findingId, reason }),
	restore: (id: string, findingId: string) =>
		request<{ restored: boolean }>(`/api/reviews/${id}/dismissals/${findingId}`, { method: 'DELETE' })
};
