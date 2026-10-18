'use client';

import type { AgentProvider, AgentStatus, ModelSettings } from '@recoder/shared';
import { Button } from '@recoder/ui';
import { Plus } from 'lucide-react';

import { CheckAgain } from '@/components/settings/providers/check-again';
import { CommandBlock } from '@/components/settings/providers/command-block';
import { joinNames } from '@/lib/queue/format';
import { agentReady, useSettings } from '@/lib/settings/settings-store';

import { SetupStep } from './setup-step';

/** Names past this many fold into "and N more". */
const NAMED = 2;

interface StepProps {
	done: boolean;
	current: boolean;
}

/** "OpenRouter", "OpenRouter and OpenAI", "OpenRouter, OpenAI and 3 more". */
function shortList(names: string[]): string {
	if (names.length <= NAMED + 1) return joinNames(names);

	return `${names.slice(0, NAMED).join(', ')} and ${names.length - NAMED} more`;
}

/** What is connected: OpenCode's providers, else the agents that bring their own models, else the env variables. */
function connectedLine(providers: AgentProvider[], models: ModelSettings | null): string {
	const connected = providers.filter((provider) => provider.connected).map((provider) => provider.name);

	if (connected.length > 0) return `${shortList(connected)} connected`;

	const sources = new Set((models?.models ?? []).map((entry) => entry.source ?? entry.agent ?? 'Custom'));

	if (sources.size > 0) return `${shortList([...sources])} models ready`;

	return 'Set by the RECODER_REVIEW_* variables';
}

/** Why no provider can be added yet: OpenCode is missing, can't run, or the check failed. */
function blockedLine(manager: AgentStatus | undefined, agentError: string | null): string {
	if (agentError) return agentError;
	if (!manager) return 'Can’t find OpenCode on this machine.';
	if (!manager.installed) return 'Reviews run through OpenCode, which isn’t installed.';

	return manager.error ?? 'OpenCode isn’t ready.';
}

/**
 * Step one: a model provider. Providers are added in OpenCode, so while it is
 * missing the step shows the install command and a way to check again.
 */
export function ProviderStep({ done, current, onAdd }: StepProps & { onAdd: () => void }) {
	const providers = useSettings((state) => state.providers);
	const models = useSettings((state) => state.models);
	const agents = useSettings((state) => state.agents);
	const agentError = useSettings((state) => state.agentError);
	const manager = agents.find((agent) => agent.providers);
	const ready = !agentError && manager !== undefined && agentReady(manager);

	const description = done
		? connectedLine(providers, models)
		: ready
			? 'No providers yet. Add one to pick models for reviews.'
			: blockedLine(manager, agentError);

	return (
		<SetupStep done={done} current={current} title="Connect a model provider" description={description}>
			{ready ? (
				<div className="setup-actions">
					<Button variant={current ? 'primary' : 'outline'} onClick={onAdd}>
						<Plus aria-hidden />
						Add a provider
					</Button>
				</div>
			) : (
				<div className="setup-blocked">
					{manager && !manager.installed ? (
						<CommandBlock hint="Install it, then check again." command={manager.install} />
					) : null}
					<div className="setup-actions">
						<CheckAgain variant={current ? 'primary' : 'outline'} />
					</div>
				</div>
			)}
		</SetupStep>
	);
}
