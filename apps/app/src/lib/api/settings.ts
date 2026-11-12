import type {
	AgentOAuthAttempt,
	AgentOAuthStatus,
	AgentProvider,
	AgentStatus,
	ModelSettings,
	ModelSettingsPatch,
	SetupStatus
} from '@recoder/shared';

import { del, post, put, request, seg, SLOW_MS } from './http';

/** What an answer must hold before the page reads it: a test of the object's own fields. */
type Shape = (value: Record<string, unknown>) => boolean;

/**
 * An answer of the shape the page reads, or the `SyntaxError` an unreadable
 * answer stands for, so a 2xx with the wrong body fails like one that isn't
 * JSON (one fixed sentence, and the error logged) instead of breaking the
 * page that reads it.
 */
function shaped<T>(shape: Shape): (answer: unknown) => T {
	return (answer) => {
		const object = typeof answer === 'object' && answer !== null && !Array.isArray(answer);

		if (!object || !shape(answer as Record<string, unknown>)) throw new SyntaxError('The answer has the wrong shape.');

		return answer as T;
	};
}

/** The review settings: the models list and the limits are what every section reads first. */
const settingsShape = shaped<ModelSettings>(
	({ models, limits }) => Array.isArray(models) && typeof limits === 'object' && limits !== null
);

const agentsShape = shaped<{ agents: AgentStatus[] }>(({ agents }) => Array.isArray(agents));

const providersShape = shaped<{ providers: AgentProvider[] }>(({ providers }) => Array.isArray(providers));

/** The agent (OpenCode and the other CLIs), its model providers, and the review models and limits. */
export const settingsApi = {
	/** The review models, efforts and limits, with every model the agents offer (a large catalog: for the pickers). */
	models: () => request<unknown>('/api/settings/models', { timeoutMs: SLOW_MS }).then(settingsShape),

	/**
	 * The same settings with only the picked models' entries, so the picks show
	 * by name with their efforts: what Settings paints from before a picker
	 * opens, at a few hundred bytes instead of the catalog.
	 */
	picks: () => request<unknown>('/api/settings/models?catalog=0', { timeoutMs: SLOW_MS }).then(settingsShape),

	/**
	 * Saves a change; the answer is the settings with only the picked models'
	 * entries, like `picks`. The server waits on the agents' model lists for a
	 * few seconds at most, so the save has a write's usual time limit.
	 */
	saveModels: (patch: ModelSettingsPatch) => put<unknown>('/api/settings/models?catalog=0', patch).then(settingsShape),

	/**
	 * What first run needs to decide whether to show, without the catalog: a
	 * few counts and flags. The server bounds its wait on the agents to a few
	 * seconds, so this has a read's usual time limit.
	 */
	status: () => request<SetupStatus>('/api/settings/status'),

	/** Each agent CLI: installed, signed in, version. `refresh` runs the check again instead of using the cache. */
	agents: (refresh = false) =>
		request<unknown>(`/api/agent${refresh ? '?refresh=1' : ''}`, { timeoutMs: SLOW_MS }).then(agentsShape),
	providers: () => request<unknown>('/api/agent/providers', { timeoutMs: SLOW_MS }).then(providersShape),

	/** Saves an API key (and any extra inputs the provider asks for) in OpenCode. */
	setKey: (id: string, key: string, inputs: Record<string, string>) =>
		put<unknown>(`/api/agent/providers/${seg(id)}/key`, { key, inputs }, { timeoutMs: SLOW_MS }).then(providersShape),
	removeProvider: (id: string) => del<unknown>(`/api/agent/providers/${seg(id)}`).then(providersShape),

	/** Starts a browser sign-in with the provider's `method`-th auth method. Poll `oauthStatus` until it settles. */
	startOAuth: (id: string, method: number, inputs: Record<string, string>) =>
		post<AgentOAuthAttempt>(`/api/agent/providers/${seg(id)}/oauth`, { method, inputs }, { timeoutMs: SLOW_MS }),
	oauthStatus: (attempt: string) => request<AgentOAuthStatus>(`/api/agent/oauth/${seg(attempt)}`),

	/** Finishes a sign-in that hands back a code to paste. */
	oauthCode: (attempt: string, code: string) =>
		post<AgentOAuthStatus>(`/api/agent/oauth/${seg(attempt)}/code`, { code }, { timeoutMs: SLOW_MS }),
	cancelOAuth: (attempt: string) => del<{ ok: boolean }>(`/api/agent/oauth/${seg(attempt)}`)
};
