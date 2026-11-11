import { expect, test } from 'bun:test';
import { detectAgents, type AgentProbe } from '../../../src/cli/init/detect-agents';

function machineWith(found: { commands?: string[]; folders?: string[] }): AgentProbe {
	return {
		homeDirectory: '/home/dev',
		hasCommand: (name) => (found.commands ?? []).includes(name),
		hasFolder: (path) => (found.folders ?? []).includes(path)
	};
}

test('an agent is found by its command on the PATH or by its folder in the home directory', () => {
	expect(detectAgents(machineWith({ commands: ['codex'] }))).toEqual(['agents']);
	expect(detectAgents(machineWith({ folders: ['/home/dev/.claude'] }))).toEqual(['claude']);
	expect(detectAgents(machineWith({ commands: ['claude', 'opencode'] }))).toEqual(['claude', 'agents']);
});

test('a machine with no agent found gets the skill for Claude Code', () => {
	expect(detectAgents(machineWith({}))).toEqual(['claude']);
});
