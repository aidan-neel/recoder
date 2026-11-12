'use client';

import type { AgentStatus } from '@recoder/shared';
import { Button, StatusGlyph, type GlyphKind } from '@recoder/ui';
import { RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';

import { cliDetail, cliFix, cliGlyph, cliState } from '@/lib/settings/providers/agent-cli';
import { CHECK_FAILED, useCheckAgain } from '@/lib/settings/providers/use-check-again';
import { useSettings } from '@/lib/settings/settings-store';

import { Command } from './providers/provider-notice';
import { SettingsGroup, SettingsRow } from './settings-group';

interface GlyphNameProps {
	kind: GlyphKind;
	/** Names the state for a screen reader; leave it out when the row's words already say it. */
	label?: string;
	children: ReactNode;
}

/** A row's name behind the glyph of its state. */
function GlyphName({ kind, label, children }: GlyphNameProps) {
	return (
		<span className="status-name">
			<StatusGlyph kind={kind} label={label} />
			{children}
		</span>
	);
}

/** The line under a CLI's name: where its binary is, set in mono, or what is wrong with it. */
function CliDetail({ agent }: { agent: AgentStatus }) {
	const state = cliState(agent);
	const text = cliDetail(agent);

	if (state === 'broken') return <span className="row-problem">{text}</span>;

	if (state === 'ready' && agent.path) {
		return (
			<span className="cli-path mono" title={agent.path}>
				{text}
			</span>
		);
	}

	return text;
}

/** One agent CLI: its state, name and version, and the command that fixes it when it needs one. */
function CliItem({ agent }: { agent: AgentStatus }) {
	const glyph = cliGlyph(agent);
	const fix = cliFix(agent);

	return (
		<div className="status-item">
			<SettingsRow
				name={
					<GlyphName kind={glyph.kind} label={glyph.label}>
						<span className="status-name-text">{agent.name}</span>
						{agent.version ? <span className="cli-version mono">{agent.version}</span> : null}
					</GlyphName>
				}
				detail={<CliDetail agent={agent} />}
			/>
			{fix ? (
				<div className="cli-fix">
					<Command command={fix} />
				</div>
			) : null}
		</div>
	);
}

/** The check itself failed: the reason, above the rows of the last check that worked. */
function CheckFailed({ reason }: { reason: string }) {
	return (
		<div className="status-item">
			<SettingsRow
				name={
					<GlyphName kind="failed">
						<span className="status-name-text">{CHECK_FAILED}</span>
					</GlyphName>
				}
				detail={<span className="row-problem">{reason}</span>}
			/>
		</div>
	);
}

/** Settings → Models → Agent CLIs: each CLI Recoder runs reviews with, and whether it is ready. */
export function AgentClis() {
	const agents = useSettings((state) => state.agents);
	const agentError = useSettings((state) => state.agentError);
	const check = useCheckAgain();

	return (
		<SettingsGroup
			title="Agent CLIs"
			action={
				<Button variant="ghost" status={check.status} successLabel="Checked" onClick={check.run}>
					<RotateCw aria-hidden />
					Check again
				</Button>
			}
		>
			{agentError ? <CheckFailed reason={agentError} /> : null}
			{agents.map((agent) => (
				<CliItem key={agent.id} agent={agent} />
			))}
			{agents.length === 0 && !agentError ? (
				<SettingsRow name="No agent CLIs listed" detail="The review server named none. Check again." />
			) : null}
		</SettingsGroup>
	);
}
