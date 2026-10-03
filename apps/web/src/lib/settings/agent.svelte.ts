import type { AgentProvider, AgentStatus } from '@recoder/shared';
import { modelSettingsUi } from './model-settings.svelte';
import { serverApi } from '../api/server-api';

/** Installed and running, and signed in when the CLI has its own account. */
export function isReady(status: AgentStatus): boolean {
	return status.installed && !status.error && status.signedIn !== false;
}

/** The agent CLIs behind reviews, and the model providers OpenCode is signed in to. */
class AgentState {
	/** Every known agent, installed or not; null until the first load. */
	statuses = $state<AgentStatus[] | null>(null);
	providers = $state<AgentProvider[] | null>(null);
	error = $state<string | null>(null);
	checking = $state(false);

	/** The agent that connects model providers itself (OpenCode). */
	get status(): AgentStatus | null {
		return this.statuses?.find((s) => s.providers) ?? null;
	}

	/** At least one agent can run models, so the model pickers have something to offer. */
	get anyReady(): boolean {
		return (this.statuses ?? []).some(isReady);
	}

	/** Providers the agent can reach. */
	get connected(): AgentProvider[] {
		return (this.providers ?? []).filter((p) => p.connected);
	}

	/** Status, then providers once the agent is up. `refresh` re-detects the binary. */
	async load(refresh = false): Promise<void> {
		this.checking = refresh;

		try {
			const { agents } = await serverApi.agentStatus(refresh);

			this.statuses = agents;
			this.error = null;
			if (this.status && isReady(this.status)) this.providers = (await serverApi.agentProviders()).providers;
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
