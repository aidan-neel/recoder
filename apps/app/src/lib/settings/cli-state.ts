import type { AgentStatus } from '@recoder/shared';

/** Where one agent CLI stands. */
export type CliState = 'ready' | 'missing' | 'broken' | 'signed-out';

/** Where a CLI stands, from what the agent check reported. */
export function cliState(agent: AgentStatus): CliState {
	if (!agent.installed) return 'missing';
	if (agent.error) return 'broken';

	return agent.signedIn === false ? 'signed-out' : 'ready';
}

/**
 * The command that fixes a CLI's state, with what to do with it; none when
 * the CLI is ready or broken. Settings shows it under the CLI's row, and
 * remembers how many there were, so the next load's skeleton is as tall.
 */
export function cliFix(agent: AgentStatus): { hint: string; command: string } | null {
	const state = cliState(agent);

	if (state === 'missing') return { hint: 'Install it, then check again.', command: agent.install };

	if (state === 'signed-out' && agent.login) {
		return { hint: 'Sign in from a terminal, then check again.', command: agent.login };
	}

	return null;
}
