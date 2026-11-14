import { describe, expect, test } from 'bun:test';
import type { AgentStatus } from '@recoder/shared';

import { cliDetail, cliFix, cliGlyph, cliState } from '../../../src/lib/settings/providers/agent-cli';

function agent(patch: Partial<AgentStatus>): AgentStatus {
	return {
		id: 'claude',
		name: 'Claude Code',
		installed: true,
		version: '1.0.0',
		path: '/usr/bin/claude',
		error: null,
		install: 'npm i -g @anthropic-ai/claude-code',
		signedIn: true,
		login: 'claude login',
		providers: false,
		config: null,
		setup: { install: false, signIn: false },
		...patch
	};
}

describe('an agent CLI’s state', () => {
	test('missing beats broken and signed-out', () => {
		expect(cliState(agent({ installed: false, error: 'x', signedIn: false }))).toBe('missing');
	});

	test('a failed check is broken; a false sign-in is signed-out; else ready', () => {
		expect(cliState(agent({ error: 'too old' }))).toBe('broken');
		expect(cliState(agent({ signedIn: false }))).toBe('signed-out');
		expect(cliState(agent({}))).toBe('ready');
	});

	test('the fix is the install command while missing, the login command while signed out', () => {
		expect(cliFix(agent({ installed: false }))).toBe('npm i -g @anthropic-ai/claude-code');
		expect(cliFix(agent({ signedIn: false }))).toBe('claude login');

		expect(cliFix(agent({}))).toBeNull();
		expect(cliFix(agent({ error: 'x' }))).toBeNull();
	});

	test('the detail line is the path when ready, the state’s words or the error otherwise', () => {
		expect(cliDetail(agent({}))).toBe('/usr/bin/claude');
		expect(cliDetail(agent({ error: 'too old' }))).toBe('too old');
		expect(cliDetail(agent({ signedIn: false }))).toBe('Not signed in');
		expect(cliDetail(agent({ installed: false, path: null }))).toBe('Not installed');
		expect(cliGlyph(agent({})).kind).toBe('ok');
	});
});
