import { agentReady } from '@recoder/shared';
import type { AgentProvider, AgentStatus, ModelSettings, ModelSettingsPatch } from '@recoder/shared';
import { create } from 'zustand';

import { failureText, isOffline } from '../api/http';
import type { LoadStatus } from '../connections/connections-store';
import { settingsApi } from '../api/settings';
import { cliFix } from './cli-state';
import { rememberCount } from './last-counts';

/**
 * Where one group's first load stands. `offline`: it failed, because the
 * server never answered or answered with an error. Once a group has loaded,
 * a reload that fails keeps it `ready`, with the last good answer on screen;
 * a retry after a failure keeps it `offline` until the answer lands.
 */
type GroupStatus = 'idle' | 'loading' | 'ready' | 'offline';

interface SettingsStore {
	/** The review settings group: the picks, efforts, limits and toggles. Ready once either read below has landed. */
	status: GroupStatus;
	/**
	 * The review settings, with the picked models' entries in `models` (every
	 * model, once the catalog loaded), so the picks show by name and effort
	 * before any picker opens. Null until loaded.
	 */
	settings: ModelSettings | null;
	/** The server's reason when it answered the first settings load with an error; null when it never answered. */
	error: string | null;
	/** The model catalog, which only the pickers and first run need. */
	catalogStatus: GroupStatus;
	/**
	 * The review settings with every model the agents offer, for the pickers
	 * and first run; the same object as `settings` once loaded. Null until the
	 * catalog loads.
	 */
	models: ModelSettings | null;
	/** The server's reason when it answered the first catalog load with an error; null when it never answered. */
	catalogError: string | null;
	/** The agents group: the agent CLIs, and the providers of the one that connects them. */
	agentsStatus: GroupStatus;
	agents: AgentStatus[];
	providers: AgentProvider[];
	/** Why the latest agent check failed, or null. The agents keep their last good answer beside it. */
	agentError: string | null;
	/** Why the latest read of the providers failed, or null. The providers keep their last good answer beside it. */
	providersError: string | null;
	/** Loads the catalog and the agents once, for first run; `refresh` runs the agent check again, then rereads the models. */
	load: (refresh?: boolean) => Promise<void>;
	/** Loads the review settings once a session, without the catalog, for the Settings sections. */
	loadSettings: () => Promise<void>;
	/** Loads the model catalog once a session, when a picker opens or first run shows. */
	loadCatalog: () => Promise<void>;
	/** Loads the agents group once; `refresh` runs the agent check again instead of using the server's cache. */
	loadAgents: (refresh?: boolean) => Promise<void>;
	/** Reads the providers again, without the agent check. */
	loadProviders: () => Promise<void>;
	/** Saves a change to the review models or limits and keeps the server's answer. Rejects on failure. */
	saveModels: (patch: ModelSettingsPatch) => Promise<void>;
	/** Takes the provider list a connect or disconnect call returned, less MCP servers, and rereads the models it changed. */
	setProviders: (providers: AgentProvider[]) => void;
}

type AgentLists = Pick<SettingsStore, 'agents' | 'providers'>;

/** The agent that connects model providers itself (OpenCode), when the server reported one. */
export function providerManager(agents: AgentStatus[]): AgentStatus | null {
	return agents.find((agent) => agent.providers) ?? null;
}

/** True when the Providers group shows: the agent that connects providers is ready. */
export function providersListed({ agents }: Pick<SettingsStore, 'agents'>): boolean {
	const manager = providerManager(agents);

	return Boolean(manager && agentReady(manager));
}

/** True when the Models group offers its pickers: an agent CLI is ready, or the settings already name a model. */
export function modelsOffered({ agents, settings }: Pick<SettingsStore, 'agents' | 'settings'>): boolean {
	return agents.some(agentReady) || Boolean(settings?.models.length);
}

/**
 * Keeps the Models group's length for the next load's skeleton: its two
 * pickers, or the one row that says no model is offered yet. It waits for
 * both the settings and the agents, which together decide it.
 */
function rememberModels(state: SettingsStore): void {
	if (state.status !== 'ready' || state.agentsStatus !== 'ready') return;

	rememberCount('models', modelsOffered(state) ? 2 : 1);
}

/** The providers the Providers group lists as connected; none when the group doesn't show. */
function connectedCount(lists: AgentLists): number {
	return providersListed(lists) ? lists.providers.filter((provider) => provider.connected).length : 0;
}

/**
 * Keeps the Providers group's shape for the next load's skeleton: its rows
 * (one per connected provider, its empty row when there are none, or none
 * when it doesn't show) and how many are connected, which decides whether
 * Add provider sits in its head. A list that failed with nothing to show says
 * nothing about its length, so the last good counts stay.
 */
function rememberProviders(state: AgentLists & Pick<SettingsStore, 'providersError'>): void {
	if (state.providersError && state.providers.length === 0) return;

	const connected = connectedCount(state);

	rememberCount('providers', providersListed(state) ? Math.max(1, connected) : 0);
	rememberCount('connected', connected);
}

/** What a read of the providers brought back: the list, or why it failed. */
type ProvidersResult = Partial<Pick<SettingsStore, 'providers'>> & Pick<SettingsStore, 'providersError'>;

/** What an agent load brought back: the lists that loaded, and why anything failed. */
type AgentResult = Partial<Pick<SettingsStore, 'agents' | 'providers' | 'providersError'>> &
	Pick<SettingsStore, 'agentError'>;

/**
 * The providers of the agent that connects them, as an outcome that never
 * rejects, so it can start before anyone waits on it. An answer of the wrong
 * shape fails like any other read of them, keeping the last good list.
 */
function providersOutcome(): Promise<ProvidersResult> {
	return settingsApi
		.providers()
		.then(({ providers }): ProvidersResult => ({ providers, providersError: null }))
		.catch((error: unknown) => ({ providersError: failureText(error) }));
}

/**
 * The agent CLIs, then the providers of the one that connects them, if it is
 * ready. A plain load asks for the providers at the same time, to save a
 * round trip, and drops them when that agent turns out not to be ready. A
 * refresh asks after the check, which may have changed the answer. What
 * fails to load is left out, so a failed refresh keeps the last good lists.
 */
async function agentResult(refresh: boolean): Promise<AgentResult> {
	const early = refresh ? null : providersOutcome();

	try {
		const { agents } = await settingsApi.agents(refresh);
		const manager = providerManager(agents);

		if (!manager || !agentReady(manager)) return { agents, providers: [], agentError: null, providersError: null };

		return { agents, agentError: null, ...(await (early ?? providersOutcome())) };
	} catch (error) {
		return { agentError: failureText(error) };
	}
}

/** True while a load has neither answered nor failed. */
export function pending(status: GroupStatus | LoadStatus): boolean {
	return status === 'idle' || status === 'loading';
}

/** Loads the review settings again for a Try again button; rejects while they still fail, so the button shows it. */
export async function retrySettings(): Promise<void> {
	await useSettings.getState().loadSettings();

	if (useSettings.getState().status !== 'ready') throw new Error('Settings didn’t load.');
}

/** Loads the model catalog again for a picker's Try again button; rejects while it still fails. */
export async function retryCatalog(): Promise<void> {
	await useSettings.getState().loadCatalog();

	if (useSettings.getState().catalogStatus !== 'ready') throw new Error('The models didn’t load.');
}

/** Runs the agent check again for a Try again button; rejects while it still fails. */
export async function retryAgents(): Promise<void> {
	await useSettings.getState().loadAgents();

	if (useSettings.getState().agentsStatus !== 'ready') throw new Error('The agent check failed.');
}

/** Reads the providers again for a Try again button, without the agent check; rejects while they still fail. */
export async function retryProviders(): Promise<void> {
	await useSettings.getState().loadProviders();

	if (useSettings.getState().providersError) throw new Error('The providers didn’t load.');
}

/**
 * Check again: runs the agent check, then reads the providers and the models
 * again. It rejects when the agent, the server or the provider list still
 * fails, so the button shows the failure instead of "Checked".
 */
export async function checkAgain(): Promise<void> {
	await useSettings.getState().load(true);

	const { agentError, agentsStatus, providersError } = useSettings.getState();

	if (agentError || agentsStatus === 'offline') throw new Error(agentError ?? 'offline');
	if (providersError) throw new Error(providersError);
}

/** Loads the review settings and the agents again for a Try again button; rejects while either still fails. */
export async function retryAll(): Promise<void> {
	const results = await Promise.allSettled([retrySettings(), retryAgents()]);

	if (results.some((result) => result.status === 'rejected')) throw new Error('Settings didn’t load.');
}

/** What a failed first read says: the server's reason, or null when it never answered. */
function reasonOf(failure: unknown, fallback: string): string | null {
	return isOffline(failure) ? null : failureText(failure, fallback);
}

/**
 * Settings shared by the Settings page and first run. Each group loads, fails
 * and retries on its own. The sections paint from the small settings read;
 * the model catalog loads only for a picker or first run.
 */
export const useSettings = create<SettingsStore>((set, get) => {
	/** The agents load in flight; a plain load joins any load, a refresh joins only a refresh. */
	let agentsInflight: { refresh: boolean; done: Promise<void> } | null = null;

	/** The first settings and catalog loads in flight, which every caller shares. */
	let settingsInflight: Promise<void> | null = null;
	let catalogInflight: Promise<void> | null = null;

	/** A read of the providers alone, for a Try again, which every caller shares. */
	let providersInflight: Promise<void> | null = null;

	/** Model reads and writes run one at a time, so the server's answers land in the order they were asked. */
	let queue: Promise<unknown> = Promise.resolve();

	function queued<T>(work: () => Promise<T>): Promise<T> {
		const next = queue.then(work);

		queue = next.catch(() => undefined);

		return next;
	}

	/** Takes settings that carry only the picks' entries, keeping the catalog when one has loaded. */
	function takeSettings(next: ModelSettings): void {
		const { models } = get();
		const settings = models ? { ...next, models: models.models } : next;

		set({ settings, models: models ? settings : null, status: 'ready', error: null });
		rememberCount('storage', next.configPath ? 1 : 0);
		rememberModels(get());
	}

	/** Reads the settings. A failure after a good read keeps them on screen; a first failure turns the group offline. */
	async function fetchSettings(): Promise<void> {
		if (get().status === 'idle') set({ status: 'loading' });

		try {
			takeSettings(await queued(settingsApi.picks));
		} catch (failure) {
			if (!get().settings) set({ status: 'offline', error: reasonOf(failure, 'Settings didn’t load.') });
		}
	}

	/** Reads the catalog, which brings the settings too. A failure keeps what loaded before. */
	async function fetchCatalog(): Promise<void> {
		if (get().catalogStatus === 'idle') set({ catalogStatus: 'loading' });
		if (get().status === 'idle') set({ status: 'loading' });

		try {
			const models = await queued(settingsApi.models);

			set({ models, settings: models, status: 'ready', error: null, catalogStatus: 'ready', catalogError: null });
			rememberCount('storage', models.configPath ? 1 : 0);
			rememberModels(get());
		} catch (failure) {
			if (get().models) return;

			const error = reasonOf(failure, 'The models didn’t load.');

			set({ catalogStatus: 'offline', catalogError: error });

			if (!get().settings) set({ status: 'offline', error });
		}
	}

	/** Reads the models again after something that changes which are offered: the catalog too, once anything asked for it. */
	function reread(): Promise<void> {
		return get().catalogStatus === 'idle' ? fetchSettings() : fetchCatalog();
	}

	/** Runs the agent check. A failure after a good check keeps the lists on screen beside the reason. */
	async function fetchAgents(refresh: boolean): Promise<void> {
		if (get().agentsStatus === 'idle') set({ agentsStatus: 'loading' });

		const result = await agentResult(refresh);
		const loaded = result.agents !== undefined || get().agentsStatus === 'ready';

		set({ ...result, agentsStatus: loaded ? 'ready' : 'offline' });

		if (!loaded) return;

		rememberCount('agents', get().agents.length);
		rememberCount('cliCommands', get().agents.filter(cliFix).length);
		rememberProviders(get());
		rememberModels(get());
	}

	function loadCatalog(): Promise<void> {
		if (get().catalogStatus === 'ready') return Promise.resolve();

		catalogInflight ??= fetchCatalog().finally(() => {
			catalogInflight = null;
		});

		return catalogInflight;
	}

	/** The settings alone; a catalog read already on its way brings them, so it is joined instead. */
	function loadSettings(): Promise<void> {
		if (get().status === 'ready') return Promise.resolve();
		if (catalogInflight) return catalogInflight;

		settingsInflight ??= fetchSettings().finally(() => {
			settingsInflight = null;
		});

		return settingsInflight;
	}

	/** Reads the providers alone, one read at a time; a failure keeps the last good list beside its reason. */
	function loadProviders(): Promise<void> {
		providersInflight ??= providersOutcome()
			.then((result) => {
				set(result);
				rememberProviders(get());
			})
			.finally(() => {
				providersInflight = null;
			});

		return providersInflight;
	}

	function loadAgents(refresh = false): Promise<void> {
		if (!refresh && get().agentsStatus === 'ready') return Promise.resolve();
		if (agentsInflight && (agentsInflight.refresh || !refresh)) return agentsInflight.done;

		const before = agentsInflight?.done ?? Promise.resolve();
		const done: Promise<void> = before.then(() => fetchAgents(refresh));

		agentsInflight = { refresh, done };

		void done.finally(() => {
			if (agentsInflight?.done === done) agentsInflight = null;
		});

		return done;
	}

	/** A refresh reads the models again only after the agent check, since the check makes the server list them afresh. */
	async function refreshAll(): Promise<void> {
		await loadAgents(true);
		await reread();
	}

	return {
		status: 'idle',
		settings: null,
		error: null,
		catalogStatus: 'idle',
		models: null,
		catalogError: null,
		agentsStatus: 'idle',
		agents: [],
		providers: [],
		agentError: null,
		providersError: null,
		loadSettings,
		loadCatalog,
		loadAgents,
		loadProviders,

		async load(refresh = false) {
			if (refresh) return refreshAll();

			await Promise.all([loadCatalog(), loadAgents()]);
		},

		async saveModels(patch) {
			takeSettings(await queued(() => settingsApi.saveModels(patch)));
		},

		setProviders(providers) {
			set({ providers, providersError: null });
			rememberProviders(get());
			void reread();
		}
	};
});
