import { agentReady, prettyModelName, type AgentProvider, type AgentStatus, type ModelSettings } from '@recoder/shared';

import { joinNames } from '../shell/format';
import { rolePick } from '../settings/model-options';

/** Names past this many fold into "and N more". */
const NAMED = 2;

/** "OpenRouter", "OpenRouter and OpenAI", "OpenRouter, OpenAI and 3 more". */
export function shortList(names: string[]): string {
	if (names.length <= NAMED + 1) return joinNames(names);

	return `${names.slice(0, NAMED).join(', ')} and ${names.length - NAMED} more`;
}

/** What is connected: OpenCode's providers, else the agents that bring their own models, else the env variables. */
export function connectedLine(providers: AgentProvider[], models: ModelSettings | null): string {
	const connected = providers.filter((provider) => provider.connected).map((provider) => provider.name);

	if (connected.length > 0) return `${shortList(connected)} connected`;

	const sources = new Set((models?.models ?? []).map((entry) => entry.source ?? entry.agent ?? 'Custom'));

	if (sources.size > 0) return `${shortList([...sources])} models ready`;

	return 'Set by the RECODER_REVIEW_* variables';
}

/** Why no provider can be added yet: OpenCode is missing, can't run, or the check failed. */
export function blockedLine(manager: AgentStatus | undefined, agentError: string | null): string {
	if (agentError) return agentError;
	if (!manager) return 'Can’t find OpenCode on this machine.';
	if (!manager.installed) return 'Reviews run through OpenCode, which isn’t installed.';

	return manager.error ?? 'OpenCode isn’t ready.';
}

/** Providers can be added: the check passed and the agent that connects them is ready. */
export function providerReady(manager: AgentStatus | undefined, agentError: string | null): boolean {
	return !agentError && manager !== undefined && agentReady(manager);
}

/** The provider step's one line: what is connected once done, else why it waits; null when it is ready to add one. */
export function providerDescription({
	done,
	providers,
	models,
	manager,
	agentError
}: {
	done: boolean;
	providers: AgentProvider[];
	models: ModelSettings | null;
	manager: AgentStatus | undefined;
	agentError: string | null;
}): string | null {
	if (done) return connectedLine(providers, models);

	return providerReady(manager, agentError) ? null : blockedLine(manager, agentError);
}

/** "Tracking acme/api", or how many once there are several. */
export function trackingLine(names: string[]): string {
	return names.length === 1 ? `Tracking ${names[0]}` : `Tracking ${names.length} repositories`;
}

/** The repository step's one line once done: what is tracked. Null before. */
export function repoDescription({ done, names }: { done: boolean; names: string[] }): string | null {
	return done ? trackingLine(names) : null;
}

/** The model reviews run on, by name; null when none resolves. */
export function reviewModelName(models: ModelSettings | null): string | null {
	if (!models) return null;

	const pick = rolePick(models, 'orchestrator');

	if (pick.option) return pick.option.name;

	const id = pick.id ?? models.model;

	return id ? prettyModelName(id) : null;
}
