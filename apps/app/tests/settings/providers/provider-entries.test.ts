import { describe, expect, test } from 'bun:test';
import type { AgentStatus } from '@recoder/shared';

import { dialogClis, missingClis } from '../../../src/lib/settings/providers/provider-entries';

function cli(id: string, patch: Partial<AgentStatus> = {}): AgentStatus {
	return {
		id,
		name: id,
		installed: false,
		version: null,
		path: null,
		error: null,
		install: `install ${id}`,
		signedIn: null,
		login: null,
		providers: false,
		config: null,
		setup: { install: true, signIn: false },
		...patch
	};
}

describe('Add provider entries', () => {
	test('lists only missing installable CLIs and omits env-configured ones like custom-command', () => {
		const agents = [
			cli('claude-code', { installed: true }),
			cli('custom-command', { setup: { install: false, signIn: false } }),
			cli('pi'),
			cli('cursor'),
			cli('copilot')
		];

		expect(missingClis(agents).map((agent) => agent.id)).toEqual(['pi', 'cursor', 'copilot']);
	});

	test('a CLI installed during the dialog’s opening stays in the list so it confirms in place', () => {
		const openedMissing = new Set(['pi', 'cursor']);

		const agents = [
			cli('claude-code', { installed: true }),
			cli('custom-command', { setup: { install: false, signIn: false } }),
			cli('pi'),
			cli('cursor', { installed: true }),
			cli('copilot')
		];

		expect(dialogClis(agents, openedMissing).map((agent) => agent.id)).toEqual(['pi', 'cursor', 'copilot']);
	});
});
