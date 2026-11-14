import type {
	AgentOAuthAttempt,
	AgentOAuthStatus,
	AgentProvider,
	AgentStatus,
	ModelEntry,
	ModelSettings,
	ModelSettingsPatch,
	MyModels,
	MyModelsPatch,
	ProviderLimits
} from '@recoder/shared';

import { del, patch, post, put, request, seg } from './http';

/** Model settings as a server answers them: one older than the provider switches leaves `disabledProviders` out. */
type ServedModelSettings = Omit<ModelSettings, 'disabledProviders'> & { disabledProviders?: string[] };

/** The settings with every provider switched on when the server says nothing of the switches. */
function withSwitches(served: ServedModelSettings): ModelSettings {
	return { ...served, disabledProviders: served.disabledProviders ?? [] };
}

/** The agent (OpenCode and the other CLIs), its model providers, and the review models and limits. */
export const settingsApi = {
	models: () => request<ServedModelSettings>('/api/settings/models').then(withSwitches),
	saveModels: (changes: ModelSettingsPatch) =>
		put<ServedModelSettings>('/api/settings/models', changes).then(withSwitches),

	/** Every model of a switched-on provider, hidden ones too: the list the chooser shows with a switch on each. */
	chooserModels: () =>
		request<{ models: ModelEntry[] }>('/api/settings/models?hidden=1').then((settings) => settings.models),

	/** The models that apply to the person signed in: their own picks, or the admin's while enforced. */
	myModels: () => request<MyModels>('/api/me/models'),
	/** A member's own picks. Rejects with 403 `models-enforced` while the admin sets the models. */
	saveMyModels: (changes: MyModelsPatch) => patch<MyModels>('/api/me/models', changes),

	/** Each agent CLI: installed, signed in, version. `refresh` runs the check again instead of using the cache. */
	agents: (refresh = false) => request<{ agents: AgentStatus[] }>(`/api/agent${refresh ? '?refresh=1' : ''}`),
	providers: () => request<{ providers: AgentProvider[] }>('/api/agent/providers'),

	/** A provider's usage limits, by its key (`cli:codex`, `opencode:opencode-go`). */
	limits: (key: string, signal?: AbortSignal) => request<ProviderLimits>(`/api/agent/limits/${seg(key)}`, { signal }),

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
