import type { AgentProvider, AgentStatus } from '@recoder/shared';
import { modelSettingsUi } from './model-settings.svelte';
import { serverApi } from '../api/server-api';

/** The coding agent behind reviews (OpenCode) and the model providers it's signed in to. */
class AgentState {
	status = $state<AgentStatus | null>(null);
	providers = $state<AgentProvider[] | null>(null);
	error = $state<string | null>(null);
	checking = $state(false);

	/** Providers the agent can reach. */
	get connected(): AgentProvider[] {
		return (this.providers ?? []).filter((p) => p.connected);
	}

	/** Status, then providers once the agent is up. `refresh` re-detects the binary. */
	async load(refresh = false): Promise<void> {
		this.checking = refresh;

		try {
			const { agents } = await serverApi.agentStatus(refresh);

			this.status = agents[0] ?? null;
			this.error = null;
			if (this.status?.installed && !this.status.error) this.providers = (await serverApi.agentProviders()).providers;
			else this.providers = [];
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Could not reach the agent.';
		} finally {
			this.checking = false;
		}
	}

	/** After a sign-in or key change: new providers mean new models in the pickers. */
	async changed(providers?: AgentProvider[]): Promise<void> {
		this.providers = providers ?? (await serverApi.agentProviders()).providers;
		await modelSettingsUi.load();
	}

	async remove(id: string): Promise<void> {
		await this.changed((await serverApi.agentRemoveProvider(id)).providers);
	}
}

export const agent = new AgentState();
