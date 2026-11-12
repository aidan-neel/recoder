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

/** The command that fixes the state, with what to do with it; none when the CLI is ready or broken. */
export function cliFix(agent: AgentStatus): { hint: string; command: string } | null {
	const state = cliState(agent);

	if (state === 'missing') return { hint: 'Install it, then check again.', command: agent.install };

	if (state === 'signed-out' && agent.login) {
		return { hint: 'Sign in from a terminal, then check again.', command: agent.login };
	}

	return null;
}

/**
 * The line under the CLI's name: where the binary is, what is wrong, or the
 * state's words when there is nothing better to say.
 */
export function cliDetail(agent: AgentStatus): string {
	const state = cliState(agent);

	if (state === 'missing') return GLYPH.missing.label;
	if (state === 'broken') return agent.error ?? GLYPH.broken.label;
	if (state === 'signed-out') return GLYPH['signed-out'].label;

	return agent.path ?? GLYPH.ready.label;
}
