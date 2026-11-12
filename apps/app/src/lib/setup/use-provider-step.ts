'use client';

import type { AgentStatus } from '@recoder/shared';

import { useSettings } from '../settings/settings-store';
import { providerDescription, providerReady } from './step-text';

/** Everything the provider step shows and does. */
export interface ProviderStepView {
	/** Providers can be added: the check passed and OpenCode is ready. */
	ready: boolean;
	/** The agent that connects providers (OpenCode), for its install command and error. */
	manager: AgentStatus | undefined;
	/** Why the agent check failed, when it did. */
	agentError: string | null;
	/** The step's one line under its title. */
	description: string;
}

/**
 * First run, step one: a model provider. Providers are added in OpenCode,
 * so while it is missing the step shows the install command and a way to
 * check again. A vLLM server needs no OpenCode, so it can be connected
 * either way.
 */
export function useProviderStep(done: boolean): ProviderStepView {
	const providers = useSettings((state) => state.providers);
	const models = useSettings((state) => state.models);
	const agents = useSettings((state) => state.agents);
	const agentError = useSettings((state) => state.agentError);
	const manager = agents.find((agent) => agent.providers);

	return {
		ready: providerReady(manager, agentError),
		manager,
		agentError,
		description: providerDescription({ done, providers, models, manager, agentError })
	};
}
