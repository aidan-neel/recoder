'use client';

import type { AgentStatus } from '@recoder/shared';
import { Button, CopyButton, StatusGlyph } from '@recoder/ui';
import { RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';

import { cliState } from '@/lib/settings/providers/agent-cli';
import { entryGlyph, entryStatus, type ProviderEntry } from '@/lib/settings/providers/provider-entries';
import { useCheckAgain } from '@/lib/settings/providers/use-check-again';

import { SettingsRow } from '../settings-group';
import { AgentSetup } from './agent-setup';
import { DetailBlock } from './detail-block';
import { ProviderMark } from './provider-mark';
import { ProviderUsage } from './provider-usage';

interface ProviderDetailProps {
	entry: ProviderEntry;
	/** Blocks of this CLI's own, after its runtime: OpenCode's model providers. */
	children?: ReactNode;
}

/**
 * The right of Settings → Providers: the picked CLI's state and the command
 * that fixes it, its usage limits, and where it runs. Check again runs the
 * agent check for every CLI.
 */
export function ProviderDetail({ entry, children }: ProviderDetailProps) {
	const { agent } = entry;

	return (
		<section className="provider-detail" aria-label={agent.name}>
			<DetailHead agent={agent} />
			<StatusBlock agent={agent} />
			<ProviderUsage key={entry.key} providerKey={entry.key} />
			{children}
			<RuntimeBlock agent={agent} />
		</section>
	);
}

/** The logo, name and version, with Check again at the end. */
function DetailHead({ agent }: { agent: AgentStatus }) {
	const check = useCheckAgain();

	return (
		<div className="provider-detail-head">
			<ProviderMark agent={agent.id} />
			<h2 className="provider-detail-title">{agent.name}</h2>
			{agent.version ? <span className="provider-version">{agent.version}</span> : null}
			<Button variant="ghost" status={check.status} successLabel="Checked" onClick={check.run}>
				<RotateCw aria-hidden />
				Check again
			</Button>
		</div>
	);
}

/** Where the CLI stands, and the command that fixes it when it is not ready. */
function StatusBlock({ agent }: { agent: AgentStatus }) {
	return (
		<DetailBlock title="Status">
			<p className="detail-status">
				<StatusGlyph kind={entryGlyph(agent)} />
				{cliState(agent) === 'broken' ? (
					<span className="row-problem">{agent.error}</span>
				) : (
					<span>{entryStatus(agent)}</span>
				)}
			</p>
			<AgentSetup agent={agent} />
		</DetailBlock>
	);
}

/** Where the CLI's binary and config are and how it signs in, each with a copy button. */
function RuntimeBlock({ agent }: { agent: AgentStatus }) {
	if (!agent.path && !agent.login && !agent.config) return null;

	return (
		<DetailBlock title="Runtime">
			{agent.path ? <Fact name="Binary" value={agent.path} /> : null}
			{agent.config ? <Fact name="Config" value={agent.config} /> : null}
			{agent.authMethod ? <Fact name="Sign-in method" value={agent.authMethod} /> : null}
			{agent.login ? <Fact name="Sign-in command" value={agent.login} /> : null}
		</DetailBlock>
	);
}

/** One fact: its name over the value in mono, and a button that copies the value. */
function Fact({ name, value }: { name: string; value: string }) {
	return (
		<SettingsRow name={name} detail={<span className="detail-fact-value">{value}</span>}>
			<CopyButton variant="ghost" iconOnly value={value} label={`Copy ${name.toLowerCase()}`} />
		</SettingsRow>
	);
}
