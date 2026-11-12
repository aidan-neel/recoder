import { describe, expect, test } from 'bun:test';
import type { AgentStatus, ModelSettings } from '@recoder/shared';
import { prettyModelName } from '@recoder/shared';

import { joinNames } from '../../src/lib/queue/format';
import {
	blockedLine,
	connectedLine,
	providerDescription,
	providerReady,
	repoDescription,
	reviewModelName,
	shortList,
	trackingLine
} from '../../src/lib/setup/step-text';

function agent(patch: Partial<AgentStatus>): AgentStatus {
	return {
		id: 'opencode',
		name: 'OpenCode',
		installed: true,
		version: '1.0.0',
		path: '/usr/bin/opencode',
		error: null,
		install: 'npm i -g opencode',
		signedIn: null,
		login: null,
		providers: true,
		...patch
	};
}

describe('shortening a list of names', () => {
	test('three or fewer join plainly; past that the tail folds into a count', () => {
		expect(shortList([])).toBe(joinNames([]));
		expect(shortList(['a'])).toBe('a');
		expect(shortList(['a', 'b', 'c'])).toBe('a, b and c');
		expect(shortList(['a', 'b', 'c', 'd'])).toBe('a, b and 2 more');
	});
});

describe('the connected line', () => {
	test('connected providers are named once any exist', () => {
		const line = connectedLine(
			[
				{
					id: 'openrouter',
					name: 'OpenRouter',
					modelCount: 1,
					connected: true,
					via: 'key',
					removable: true,
					methods: []
				},
				{ id: 'x', name: 'X', modelCount: 0, connected: false, via: null, removable: false, methods: [] }
			],
			null
		);

		expect(line).toBe('OpenRouter connected');
	});

	test('with none connected it falls back to the models’ sources, then the env variables', () => {
		expect(connectedLine([], null)).toBe('Set by the RECODER_REVIEW_* variables');
	});
});

describe('why providers can’t be added yet', () => {
	test('a failed check, a missing agent and a broken one each say so', () => {
		expect(blockedLine(agent({}), 'check exploded')).toBe('check exploded');
		expect(blockedLine(undefined, null)).toBe('Can’t find OpenCode on this machine.');
		expect(blockedLine(agent({ installed: false }), null)).toBe('Reviews run through OpenCode, which isn’t installed.');
		expect(blockedLine(agent({ error: 'too old' }), null)).toBe('too old');
		expect(blockedLine(agent({ signedIn: false }), null)).toBe('OpenCode isn’t ready.');
	});

	test('ready means the check passed and the agent is installed, healthy and signed in', () => {
		expect(providerReady(agent({}), null)).toBe(true);
		expect(providerReady(agent({}), 'x')).toBe(false);
		expect(providerReady(undefined, null)).toBe(false);
		expect(providerReady(agent({ installed: false }), null)).toBe(false);
		expect(providerReady(agent({ error: 'x' }), null)).toBe(false);
		expect(providerReady(agent({ signedIn: false }), null)).toBe(false);
	});
});

describe('the provider step’s description', () => {
	test('done reports what is connected; not done invites adding one or explains the wait', () => {
		const manager = agent({});

		expect(providerDescription({ done: true, providers: [], models: null, manager, agentError: null })).toBe(
			'Set by the RECODER_REVIEW_* variables'
		);

		expect(providerDescription({ done: false, providers: [], models: null, manager, agentError: null })).toContain(
			'No providers yet'
		);

		expect(
			providerDescription({ done: false, providers: [], models: null, manager: undefined, agentError: null })
		).toBe('Can’t find OpenCode on this machine.');
	});
});

describe('the repository step’s lines', () => {
	test('tracking names the one repo or counts them', () => {
		expect(trackingLine(['web'])).toBe('Tracking web');
		expect(trackingLine(['web', 'api'])).toBe('Tracking 2 repositories');
		expect(trackingLine([])).toBe('Tracking 0 repositories');
	});

	test('signed in promises the queue; otherwise it points at connecting a forge or a URL', () => {
		expect(repoDescription({ done: true, names: ['web'], signedIn: true })).toBe('Tracking web');

		expect(repoDescription({ done: false, names: [], signedIn: true })).toBe(
			'Its open pull requests show up in the queue.'
		);

		expect(repoDescription({ done: false, names: [], signedIn: false })).toContain('Connect GitHub or GitLab');
	});
});

describe('the review model’s display name', () => {
	function settings(model: string): ModelSettings {
		return {
			configured: true,
			baseUrl: '',
			model,
			apiKeyPreview: null,
			sharedModelId: null,
			models: [],
			subagentCap: 8,
			tokenBudget: 'medium',
			reportLowSeverity: true,
			limits: { maxFiles: 20, maxDiffChars: 60_000, maxFileChars: 12_000 }
		};
	}

	test('falls back to the saved model id pretty-printed', () => {
		expect(reviewModelName(settings('openai/gpt-5.2'))).toBe(prettyModelName('openai/gpt-5.2'));
	});

	test('nothing saved resolves to null', () => {
		expect(reviewModelName(settings(''))).toBeNull();
		expect(reviewModelName(null)).toBeNull();
	});
});
