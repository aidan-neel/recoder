import type { AgentProvider, AgentStatus, ModelSettings, ModelSettingsPatch } from '@recoder/shared';
import { create } from 'zustand';

import { failureText, isOffline, OFFLINE_TEXT } from '../api/http';
import { settingsApi } from '../api/settings';

/** `offline`: the review server did not answer. */
type SettingsStatus = 'idle' | 'loading' | 'ready' | 'offline';

interface SettingsStore {
	status: SettingsStatus;
	/** Review models, efforts and limits. Null until loaded. */
	models: ModelSettings | null;
	agents: AgentStatus[];
	providers: AgentProvider[];
	/** The server's reason when it answered the first load with an error; null when it never answered. */
	error: string | null;
	/** Why the agent check or the provider list failed; the models and limits still load without them, and the lists keep their last good answer. */
	agentError: string | null;
	/** Loads everything once; `refresh` re-runs the agent check and reloads. */
	load: (refresh?: boolean) => Promise<void>;
	/** Saves a change to the review models or limits and keeps the server's answer. Rejects on failure. */
	saveModels: (patch: ModelSettingsPatch) => Promise<void>;
	/** Takes the provider list a connect or disconnect call returned, less MCP servers, and reloads the models it changed. */
	setProviders: (providers: AgentProvider[]) => void;
}

/** Installed and running, and signed in when the CLI has its own account. */
export function agentReady(agent: AgentStatus): boolean {
	return agent.installed && !agent.error && agent.signedIn !== false;
}

type AgentState = Partial<Pick<SettingsStore, 'agents' | 'providers'>> & Pick<SettingsStore, 'agentError'>;

/** A failure the server explains becomes `agentError`; a server that never answered throws. */
function agentFailure(error: unknown): AgentState {
	if (isOffline(error)) throw error;

	return { agentError: failureText(error, 'Couldn’t reach the agent.') };
}

/** The providers of the agent that connects them itself (OpenCode), or why they did not load. */
async function loadProviders(): Promise<AgentState> {
	try {
		const { providers } = await settingsApi.providers();

		return { providers, agentError: null };
	} catch (error) {
		return agentFailure(error);
	}
}

/**
 * The agent CLIs, then the providers of the one that connects them once it
 * is ready. What fails to load is left out, so a failed refresh keeps the
 * last good lists on screen beside the reason.
 */
async function loadAgents(refresh: boolean): Promise<AgentState> {
	try {
		const { agents } = await settingsApi.agents(refresh);
		const manager = agents.find((agent) => agent.providers);

		if (!manager || !agentReady(manager)) return { agents, providers: [], agentError: null };

		return { agents, ...(await loadProviders()) };
	} catch (error) {
		return agentFailure(error);
	}
}

/** Settings shared by the Settings page and first run. */
export const useSettings = create<SettingsStore>((set, get) => {
	/** The load in flight; a plain load joins any load, a refresh joins only a refresh. */
	let inflight: { refresh: boolean; done: Promise<void> } | null = null;

	/** Model reads and writes run one at a time, so the server's answers land in the order they were asked. */
	let queue: Promise<unknown> = Promise.resolve();

	function queued<T>(work: () => Promise<T>): Promise<T> {
		const next = queue.then(work);

		queue = next.catch(() => undefined);

		return next;
	}

	/**
	 * Fetches the models and the agents side by side. A failed refresh keeps
	 * what is on screen; only a first load that fails turns the page offline.
	 */
	async function fetchAll(refresh: boolean): Promise<void> {
		if (get().status === 'idle') set({ status: 'loading' });

		const [models, agents] = await Promise.allSettled([queued(settingsApi.models), loadAgents(refresh)]);

		if (agents.status === 'fulfilled') set(agents.value);
		else set({ agentError: OFFLINE_TEXT });

		if (models.status === 'fulfilled') return set({ models: models.value, status: 'ready', error: null });

		if (get().models) return;

		set({
			status: 'offline',
			error: isOffline(models.reason) ? null : failureText(models.reason, 'Settings didn’t load.')
		});
	}

	return {
		status: 'idle',
		models: null,
		agents: [],
		providers: [],
		error: null,
		agentError: null,

		load(refresh = false) {
			if (!refresh && get().status === 'ready') return Promise.resolve();
			if (inflight && (inflight.refresh || !refresh)) return inflight.done;

			const before = inflight?.done ?? Promise.resolve();
			const done: Promise<void> = before.then(() => fetchAll(refresh));

			inflight = { refresh, done };

			void done.finally(() => {
				if (inflight?.done === done) inflight = null;
			});

			return done;
		},

		async saveModels(patch) {
			const models = await queued(() => settingsApi.saveModels(patch));

			set({ models, status: 'ready' });
		},

		setProviders(providers) {
			set({ providers });

			void queued(settingsApi.models)
				.then((models) => set({ models }))
				.catch(() => undefined);
		}
	};
});
