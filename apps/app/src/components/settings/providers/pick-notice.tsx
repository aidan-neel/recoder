'use client';

import type { AgentStatus } from '@recoder/shared';
import type { ReactNode } from 'react';

import { OFFLINE_DETAIL, OFFLINE_TEXT } from '@/lib/api/http';
import { retryProviders } from '@/lib/settings/settings-store';

import { TryAgain } from '../group-notice';
import { CHECK_FAILED, CheckAgain } from './check-again';
import { CommandBlock } from './command-block';
import { PROVIDERS_FAILED } from './provider-list';
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

/** Why the provider list is empty: the server is down, the check or the list failed, or the agent isn't ready. */
export function PickNotice({ source }: { source: Exclude<ProviderSource, { state: 'loading' | 'ready' }> }) {
	if (source.state === 'offline') {
		return (
			<Notice lead={OFFLINE_TEXT} rest={OFFLINE_DETAIL}>
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

	if (source.state === 'unlisted') {
		return (
			<Notice lead={PROVIDERS_FAILED} rest={source.message}>
				<TryAgain retry={retryProviders} variant="outline" />
			</Notice>
		);
	}

	return <UnreadyNotice manager={source.manager} />;
}
