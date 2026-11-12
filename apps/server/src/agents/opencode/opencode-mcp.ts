import type { AgentRunOptions } from '../contract';
import { toolHost, type ToolLease } from '../tools/mcp-host';
import type { SessionScope } from './opencode-session';

/**
 * Leases a tool slot for a run and registers it with OpenCode. It is registered again on every lease: OpenCode
 * forgets added servers when it restarts or reloads its providers, and adding one it already has is cheap. A slot
 * OpenCode refused is given back at once.
 */
export async function leaseOpenCodeTools(
	scope: SessionScope,
	{ tools, runTool, onEvent, signal }: Pick<AgentRunOptions, 'tools' | 'runTool' | 'onEvent' | 'signal'>
): Promise<ToolLease> {
	const lease = toolHost.lease(tools, runTool, onEvent);

	try {
		const api = await scope.server.api();

		await api.addMcp(scope.directory, lease.name, lease.url, signal);
	} catch (error) {
		lease.release();

		throw error;
	}

	return lease;
}
