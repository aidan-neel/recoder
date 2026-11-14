import { providerKey, type AgentProvider, type AgentStatus } from '@recoder/shared';
import type { GlyphKind } from '@recoder/ui';

import { cliGlyph, cliState } from './agent-cli';

/**
 * One entry of Settings → Providers: an installed agent CLI. `key` is the
 * shared provider key that its switch saves and the limits route takes. The
 * model providers OpenCode connects show inside OpenCode's details.
 */
export interface ProviderEntry {
	key: string;
	agent: AgentStatus;
}

/** The Providers list: the installed agent CLIs, in the server's order. Add provider offers the rest. */
export function providerEntries(agents: readonly AgentStatus[]): ProviderEntry[] {
	return agents
		.filter((agent) => agent.installed)
		.map((agent) => ({ key: providerKey({ kind: 'cli', id: agent.id }), agent }));
}

/** The agent CLIs that are not installed, which Add provider lists with their install commands. */
export function missingClis(agents: readonly AgentStatus[]): AgentStatus[] {
	return agents.filter((agent) => !agent.installed);
}

/** The model providers the manager is connected to, in its order, each with its switch key. */
export function connectedProviders(providers: readonly AgentProvider[]): { key: string; provider: AgentProvider }[] {
	return providers
		.filter((provider) => provider.connected)
		.map((provider) => ({ key: providerKey({ kind: 'opencode', id: provider.id }), provider }));
}

/** The line under a CLI's name: how it is signed in, or what stops it. */
export function entryStatus(agent: AgentStatus): string {
	if (cliState(agent) !== 'ready') return cliGlyph(agent).label;
	if (agent.signedIn === null) return 'Ready';

	return agent.authMethod ? `Signed in · ${agent.authMethod}` : 'Signed in';
}

/** The glyph beside the status line. */
export function entryGlyph(agent: AgentStatus): GlyphKind {
	return cliGlyph(agent).kind;
}
