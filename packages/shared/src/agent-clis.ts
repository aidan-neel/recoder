import { VLLM_MODEL_PREFIX } from './vllm';

/** What the apps know of an agent CLI without asking the server. */
export interface AgentCli {
	/** The id of the server's adapter: also the model provider, and with a colon the prefix of its model ids. */
	id: string;
	/** What people call the CLI. */
	name: string;
	/**
	 * Whether pickers show the CLI's models under its {@link AgentCli.name}. OpenCode's go under the hosted provider
	 * each routes to, and a custom command's under the name its config gives it.
	 */
	groupsModelsUnderName: boolean;
}

/**
 * Every agent CLI the server runs, one entry per adapter in `apps/server/src/agents/registry.ts`; a server test
 * keeps the two lists equal. A new adapter adds its entry here and nothing else in this package.
 */
export const AGENT_CLIS: readonly AgentCli[] = [
	{ id: 'opencode', name: 'OpenCode', groupsModelsUnderName: false },
	{ id: 'claude-code', name: 'Claude Code', groupsModelsUnderName: true },
	{ id: 'devin', name: 'Devin', groupsModelsUnderName: true },
	{ id: 'custom-command', name: 'Custom command', groupsModelsUnderName: false },
	{ id: 'codex', name: 'Codex', groupsModelsUnderName: true }
];

/** The agent CLI whose id is `id` (a model provider), or null for a provider that is not one. */
export function agentCli(id: string | undefined): AgentCli | null {
	return AGENT_CLIS.find((cli) => cli.id === id) ?? null;
}

/** The agent CLI that runs model `id` (`claude-code:opus`), or null for a model no agent CLI runs. */
export function agentCliOfModel(id: string): AgentCli | null {
	return AGENT_CLIS.find((cli) => id.startsWith(`${cli.id}:`)) ?? null;
}

/**
 * True when Recoder routes model `id` itself, whatever the saved models say: an agent CLI runs it
 * (`devin:swe-2-high`), or a captured vLLM server serves it (`vllm:<server>/<model>`).
 */
export function isRoutedModelId(id: string): boolean {
	return id.startsWith(VLLM_MODEL_PREFIX) || agentCliOfModel(id) !== null;
}
