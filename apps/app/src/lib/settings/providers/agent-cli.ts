import type { AgentStatus } from '@recoder/shared';
import type { GlyphKind } from '@recoder/ui';

/** Where one agent CLI stands. */
export type CliState = 'ready' | 'missing' | 'broken' | 'signed-out';

/** The glyph and what a screen reader hears for each state. */
const GLYPH: Record<CliState, { kind: GlyphKind; label: string }> = {
	ready: { kind: 'ok', label: 'Ready' },
	missing: { kind: 'dismissed', label: 'Not installed' },
	broken: { kind: 'failed', label: 'Can’t run' },
	'signed-out': { kind: 'medium', label: 'Not signed in' }
};

/** Where the agent CLI stands: missing, broken, signed out, or ready. */
export function cliState(agent: AgentStatus): CliState {
	if (!agent.installed) return 'missing';
	if (agent.error) return 'broken';

	return agent.signedIn === false ? 'signed-out' : 'ready';
}

/** The glyph kind and its accessible label for the CLI's state. */
export function cliGlyph(agent: AgentStatus): { kind: GlyphKind; label: string } {
	return GLYPH[cliState(agent)];
}

/** The command that fixes the state: the install command while missing, the login command while signed out. */
export function cliFix(agent: AgentStatus): string | null {
	const state = cliState(agent);

	if (state === 'missing') return agent.install;
	if (state === 'signed-out') return agent.login;

	return null;
}
