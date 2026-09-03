import { env } from '$env/dynamic/public';
import type {
	CreateRepoInput,
	CreateReviewInput,
	DiscussRequest,
	DiscussResponse,
	FileDiff,
	ModelSettings,
	ModelSettingsPatch,
	Provider,
	ProviderAuth,
	PullPreview,
	PullRequest,
	RemoteRepo,
	Repo,
	Review
} from '@recoder/shared';

const base = (env.PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

/** API origin for non-fetch uses (e.g. EventSource). */
export const apiBase = base;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${base}${path}`, {
		...init,
		headers: { 'content-type': 'application/json', ...init?.headers }
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as { error?: string } | null;
		throw new Error(body?.error ?? `API ${res.status}`);
	}
	return (await res.json()) as T;
}

export function detectProvider(url: string): 'github' | 'gitlab' {
	return /gitlab\./i.test(url) ? 'gitlab' : 'github';
}

export const serverApi = {
	listRepos: () => req<Repo[]>('/api/repos'),
	createRepo: (input: CreateRepoInput) =>
		req<Repo>('/api/repos', { method: 'POST', body: JSON.stringify(input) }),
	previewPr: (repoId: string, n: number) =>
		req<PullPreview>(`/api/repos/${repoId}/pulls/${n}`),
	listPrs: (repoId: string) => req<PullRequest[]>(`/api/repos/${repoId}/pulls`),
	listReviews: () => req<Review[]>('/api/reviews'),
	getReview: (id: string) => req<Review>(`/api/reviews/${id}`),
	getReviewFiles: (id: string) => req<FileDiff[]>(`/api/reviews/${id}/files`),
	discuss: (reviewId: string, input: DiscussRequest) =>
		req<DiscussResponse>(`/api/reviews/${reviewId}/discuss`, {
			method: 'POST',
			body: JSON.stringify(input)
		}),
	queueReview: (input: CreateReviewInput) =>
		req<Review>('/api/reviews', { method: 'POST', body: JSON.stringify(input) }),
	authStatus: () => req<{ github: ProviderAuth; gitlab: ProviderAuth }>('/api/auth/status'),
	saveToken: (provider: Provider, token: string) =>
		req<{ provider: Provider; user: string | null }>('/api/auth/token', {
			method: 'POST',
			body: JSON.stringify({ provider, token })
		}),
	clearToken: (provider: Provider) =>
		req<{ cleared: boolean }>(`/api/auth/token/${provider}`, { method: 'DELETE' }),
	remoteRepos: (provider: Provider) => req<RemoteRepo[]>(`/api/auth/repos?provider=${provider}`),
	getModelSettings: () => req<ModelSettings>('/api/settings/models'),
	saveModelSettings: (patch: ModelSettingsPatch) =>
		req<ModelSettings>('/api/settings/models', { method: 'PUT', body: JSON.stringify(patch) })
};
