import type { AgentStatus } from '@recoder/shared';
import { agentById } from '../agents/registry.js';
import type { ModelConfig } from './models.js';

/**
 * The first agent CLI behind `configs` that says it is signed out, from its own status command: no model call, and
 * nothing started that outlives the check. Null when each is signed in, cannot tell, or is not an agent CLI.
 */
export async function signedOutAgent(configs: readonly Pick<ModelConfig, 'provider'>[]): Promise<AgentStatus | null> {
	const agents = new Set(configs.map((config) => agentById(config.provider)).filter((agent) => agent !== null));
	const statuses = await Promise.all([...agents].map((agent) => agent.quickStatus()));

	return statuses.find((status) => status.installed && status.signedIn === false) ?? null;
}

/** What to tell someone whose review stopped because `status`'s agent is signed out. */
export function signedOutReason(status: AgentStatus): string {
	return `${status.name} is not signed in. Sign in with \`${status.login}\`, or pick another model in Recoder settings.`;
}
