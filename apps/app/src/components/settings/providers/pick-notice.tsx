'use client';

import type { AgentStatus } from '@recoder/shared';
import type { ReactNode } from 'react';

import { OFFLINE_TEXT } from '@/lib/api/http';

import { CHECK_FAILED, CheckAgain } from './check-again';
import { CommandBlock } from './command-block';
import type { ProviderSource } from './use-provider-source';

/** A short message in place of the list, with what to do about it. */
function Notice({ lead, rest, children }: { lead: string; rest?: string; children?: ReactNode }) {
	return (
		<div role="status" className="provider-notice">
			<p className="provider-notice-text">
				<span className="text-fg">{lead}</span>
				{rest ? <> {rest}</> : null}
			</p>
			{children}
		</div>
	);
}

/** The agent that connects providers is missing, broken or signed out. */
function UnreadyNotice({ manager }: { manager: AgentStatus | null }) {
	if (!manager) return <Notice lead="No agent connects providers." rest="Check the review server." />;

	if (!manager.installed) {
		return (
			<Notice lead={`${manager.name} isn’t installed.`}>
				<CommandBlock hint="Install it, then check again." command={manager.install} />
				<CheckAgain variant="outline" />
			</Notice>
		);
	}

	return (
		<Notice lead={`${manager.name} can’t run.`} rest={manager.error ?? undefined}>
			<CheckAgain variant="outline" />
		</Notice>
	);
}

/** Why the provider list is empty: the server is down, the check failed, or the agent isn't ready. */
export function PickNotice({ source }: { source: Exclude<ProviderSource, { state: 'loading' | 'ready' }> }) {
	if (source.state === 'offline') {
		return (
			<Notice lead={OFFLINE_TEXT} rest="Start it, then try again.">
				<CheckAgain variant="outline" label="Try again" />
			</Notice>
		);
	}

	if (source.state === 'error') {
		return (
			<Notice lead={`${CHECK_FAILED}.`} rest={source.message}>
				<CheckAgain variant="outline" />
			</Notice>
		);
	}

	return <UnreadyNotice manager={source.manager} />;
}
