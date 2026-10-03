import type { AgentStatus, ModelEntry } from '@recoder/shared';
import { opencode } from './opencode/opencode';

/**
 * What every agent CLI gives Recoder: whether it's installed and usable, and
 * the models it can run. Adding a CLI is one adapter plus an entry in
 * {@link AGENTS}; the routes and Settings read only this.
 */
export interface AgentAdapter {
	readonly id: string;
	readonly name: string;
	/** Installed, version, sign-in state. Cached until `refresh`. */
	detect(refresh?: boolean): Promise<AgentStatus>;
	/** Models it can run now; throws when the agent is missing or down. */
	models(): Promise<ModelEntry[]>;
}

const AGENTS: AgentAdapter[] = [opencode];

export function agentStatuses(refresh = false): Promise<AgentStatus[]> {
	return Promise.all(AGENTS.map((agent) => agent.detect(refresh)));
}

/** Every agent's models, tagged with the agent. One that's missing or down adds none, so Settings still opens. */
export async function agentModels(): Promise<ModelEntry[]> {
	const lists = await Promise.all(
		AGENTS.map(async (agent) => {
			try {
				return (await agent.models()).map((entry) => ({ ...entry, agent: agent.name }));
			} catch {
				return [];
			}
		})
	);

	return lists.flat();
}
