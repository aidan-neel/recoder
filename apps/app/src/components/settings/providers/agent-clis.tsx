'use client';

import type { AgentStatus } from '@recoder/shared';
import { StatusGlyph, type GlyphKind } from '@recoder/ui';
import { AnimatePresence } from 'motion/react';
import type { ReactNode } from 'react';

import { useSettings } from '@/lib/settings/settings-store';

import { SettingsGroup, SettingsRow } from '../settings-group';
import { CHECK_FAILED, CheckAgain } from './check-again';
import { CommandBlock } from './command-block';
import { Reveal } from './reveal';

/** Where one agent CLI stands. */
type CliState = 'ready' | 'missing' | 'broken' | 'signed-out';

/** The glyph and what a screen reader hears for each state. */
const GLYPH: Record<CliState, { kind: GlyphKind; label: string }> = {
	ready: { kind: 'ok', label: 'Ready' },
	missing: { kind: 'dismissed', label: 'Not installed' },
	broken: { kind: 'failed', label: 'Can’t run' },
	'signed-out': { kind: 'medium', label: 'Not signed in' }
};

function stateOf(agent: AgentStatus): CliState {
	if (!agent.installed) return 'missing';
	if (agent.error) return 'broken';

	return agent.signedIn === false ? 'signed-out' : 'ready';
}

/** The command that fixes the state, with what to do with it; none when the CLI is ready or broken. */
function fixFor(agent: AgentStatus, state: CliState): { hint: string; command: string } | null {
	if (state === 'missing') return { hint: 'Install it, then check again.', command: agent.install };

	if (state === 'signed-out' && agent.login) {
		return { hint: 'Sign in from a terminal, then check again.', command: agent.login };
	}

	return null;
}

/** The line under the name: where the binary is, or what is wrong. A new state's words crossfade in. */
function detailOf(agent: AgentStatus, state: CliState): ReactNode {
	if (state === 'missing') return GLYPH.missing.label;
	if (state === 'broken') return agent.error;
	if (state === 'signed-out') return GLYPH['signed-out'].label;

	return (
		<span className="block truncate font-mono" title={agent.path ?? undefined}>
			{agent.path ?? GLYPH.ready.label}
		</span>
	);
}

/** One agent CLI: its state glyph, name and version, and the command to run when it needs one. */
function CliItem({ agent }: { agent: AgentStatus }) {
	const state = stateOf(agent);
	const glyph = GLYPH[state];
	const fix = fixFor(agent, state);

	return (
		<div data-ui="agent-cli" className="provider-item">
			<SettingsRow
				className="provider-row"
				leading={<StatusGlyph kind={glyph.kind} label={glyph.label} className="provider-glyph" />}
				name={
					<>
						{agent.name}
						{agent.version ? <span className="provider-version">{agent.version}</span> : null}
					</>
				}
				description={detailOf(agent, state)}
			/>
			<AnimatePresence initial={false}>
				{fix ? (
					<Reveal key={fix.command}>
						<CommandBlock hint={fix.hint} command={fix.command} />
					</Reveal>
				) : null}
			</AnimatePresence>
		</div>
	);
}

/** The check itself failed: the server's reason above the rows of the last check that worked. */
function CheckFailed({ message }: { message: string }) {
	return (
		<div className="provider-item">
			<SettingsRow
				className="provider-row"
				leading={<StatusGlyph kind="failed" className="provider-glyph" />}
				name={CHECK_FAILED}
				description={message}
			/>
		</div>
	);
}

/** Settings → Agent: each agent CLI Recoder runs reviews with, and whether it is ready. */
export function AgentClis() {
	const agents = useSettings((state) => state.agents);
	const agentError = useSettings((state) => state.agentError);

	return (
		<SettingsGroup title="Agent CLIs" action={<CheckAgain />}>
			{agentError ? <CheckFailed message={agentError} /> : null}
			{agents.map((agent) => (
				<CliItem key={agent.id} agent={agent} />
			))}
		</SettingsGroup>
	);
}
