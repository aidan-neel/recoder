import type { CreateRepoInput, Provider, ProviderAuth, RemoteRepo, Repo } from '@recoder/shared';

import { del, post, request, seg } from './http';

/** The forges Recoder reads pull requests from. */
export type Forge = Exclude<Provider, 'local'>;

/** Forge tokens and the repositories Recoder tracks. The tracked list itself is `reviewsApi.repos`. */
export const connectionsApi = {
	status: () => request<Record<Forge, ProviderAuth>>('/api/auth/status'),

	/** Checks the token with the forge, then saves it to `tokens.json` in the server's data folder. `host` is for a self-hosted GitLab. */
	saveToken: (provider: Forge, token: string, host?: string) =>
		post<{ provider: Forge; user: string | null }>('/api/auth/token', {
			provider,
			token,
			...(host ? { host } : {})
		}),
	clearToken: (provider: Forge) => del<{ cleared: boolean }>(`/api/auth/token/${seg(provider)}`),

	/** Repositories the token can see, to pick from. */
	remoteRepos: (provider: Forge) => request<RemoteRepo[]>(`/api/auth/repos?provider=${seg(provider)}`),
	addRepo: (input: CreateRepoInput) => post<Repo>('/api/repos', input),

	/** Kept alive, so a removal sent as the page closes (its Undo still on offer) still lands. */
	removeRepo: (id: string) =>
		request<{ deleted: boolean }>(`/api/repos/${seg(id)}`, { method: 'DELETE', keepalive: true })
};
