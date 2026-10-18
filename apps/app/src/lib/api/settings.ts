import type {
	AgentOAuthAttempt,
	AgentOAuthStatus,
	AgentProvider,
	AgentStatus,
	ModelSettings,
	ModelSettingsPatch
} from '@recoder/shared';

import { del, post, put, request, seg } from './http';

/** The agent (OpenCode and the other CLIs), its model providers, and the review models and limits. */
export const settingsApi = {
	models: () => request<ModelSettings>('/api/settings/models'),
	saveModels: (patch: ModelSettingsPatch) => put<ModelSettings>('/api/settings/models', patch),

	/** Each agent CLI: installed, signed in, version. `refresh` runs the check again instead of using the cache. */
	agents: (refresh = false) => request<{ agents: AgentStatus[] }>(`/api/agent${refresh ? '?refresh=1' : ''}`),
	providers: () => request<{ providers: AgentProvider[] }>('/api/agent/providers'),

	/** Saves an API key (and any extra inputs the provider asks for) in OpenCode. */
	setKey: (id: string, key: string, inputs: Record<string, string>) =>
		put<{ providers: AgentProvider[] }>(`/api/agent/providers/${seg(id)}/key`, { key, inputs }),
	removeProvider: (id: string) => del<{ providers: AgentProvider[] }>(`/api/agent/providers/${seg(id)}`),

	/** Starts a browser sign-in with the provider's `method`-th auth method. Poll `oauthStatus` until it settles. */
	startOAuth: (id: string, method: number, inputs: Record<string, string>) =>
		post<AgentOAuthAttempt>(`/api/agent/providers/${seg(id)}/oauth`, { method, inputs }),
	oauthStatus: (attempt: string) => request<AgentOAuthStatus>(`/api/agent/oauth/${seg(attempt)}`),

	/** Finishes a sign-in that hands back a code to paste. */
	oauthCode: (attempt: string, code: string) =>
		post<AgentOAuthStatus>(`/api/agent/oauth/${seg(attempt)}/code`, { code }),
	cancelOAuth: (attempt: string) => del<{ ok: boolean }>(`/api/agent/oauth/${seg(attempt)}`)
};
