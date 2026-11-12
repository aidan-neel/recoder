import { expect, test } from 'bun:test';
import { leaseOpenCodeTools } from '../../../src/agents/opencode/opencode-mcp';
import type { SessionScope } from '../../../src/agents/opencode/opencode-session';
import { toolHost } from '../../../src/agents/tools/mcp-host';

/** A stand-in OpenCode that records the servers it is told to add, and refuses them when `refuse` is set. */
function scope(added: { name: string; url: string }[], refuse = false): SessionScope {
	const addMcp = async (_directory: string, name: string, url: string) => {
		added.push({ name, url });

		if (refuse) throw new Error('refused');
	};

	return { server: { api: async () => ({ addMcp }) } as unknown as SessionScope['server'], directory: '/tmp/empty' };
}

const run = {
	tools: ['search'],
	runTool: async () => ({ text: 'ok', isError: false }),
	onEvent: () => {},
	signal: new AbortController().signal
};

test('a slot OpenCode could not connect to is given back for the next run', async () => {
	const added: { name: string; url: string }[] = [];

	await expect(leaseOpenCodeTools(scope(added, true), run)).rejects.toThrow('refused');

	const lease = await leaseOpenCodeTools(scope(added), run);

	lease.release();
	toolHost.stop();

	expect(added[1].name).toBe(added[0].name);
});
