import { describe, expect, test } from 'bun:test';
import type { AgentAuthMethod, AgentProvider } from '@recoder/shared';

import {
	answersFor,
	deviceCode,
	missingAnswer,
	pickGroups,
	shownPrompts
} from '../../src/lib/settings/provider-options';

/** GitHub Copilot as OpenCode describes it: a deployment choice, then a URL only for Enterprise. */
const COPILOT: AgentAuthMethod = {
	index: 0,
	type: 'oauth',
	label: 'Login with GitHub Copilot',
	prompts: [
		{
			type: 'select',
			key: 'deploymentType',
			message: 'Select GitHub deployment type',
			options: [
				{ label: 'GitHub.com', value: 'github.com', hint: 'Public' },
				{ label: 'GitHub Enterprise', value: 'enterprise', hint: null }
			],
			when: null
		},
		{
			type: 'text',
			key: 'enterpriseUrl',
			message: 'Enter your GitHub Enterprise URL or domain',
			placeholder: null,
			when: { key: 'deploymentType', op: 'eq', value: 'enterprise' }
		},
		{
			type: 'text',
			key: 'label',
			message: 'Name this account (optional)',
			placeholder: null,
			when: { key: 'deploymentType', op: 'neq', value: 'enterprise' }
		}
	]
};

function provider(id: string, name = id): AgentProvider {
	return { id, name, modelCount: 0, connected: false, via: null, removable: false, methods: [] };
}

describe('deviceCode', () => {
	test('finds the code in the agent’s sign-in instructions', () => {
		expect(deviceCode('Go to github.com/login/device and enter code: AULF-57S8B')).toBe('AULF-57S8B');
		expect(deviceCode('Enter code 8F3K-29QX-ZZ01 on the page')).toBe('8F3K-29QX-ZZ01');
	});

	test('finds nothing when the instructions carry no dashed code', () => {
		expect(deviceCode('Finish signing in on the page that opened.')).toBeNull();
		expect(deviceCode('Paste the code you get back.')).toBeNull();
	});
});

describe('prompts', () => {
	test('a prompt shows only while its condition on an earlier answer holds', () => {
		const keys = (answers: Record<string, string>) => shownPrompts(COPILOT, answers).map((prompt) => prompt.key);

		expect(keys({ deploymentType: 'github.com' })).toEqual(['deploymentType', 'label']);
		expect(keys({ deploymentType: 'enterprise' })).toEqual(['deploymentType', 'enterpriseUrl']);
	});

	test('a blank required field blocks the sign-in; a blank optional one does not', () => {
		const enterprise = shownPrompts(COPILOT, { deploymentType: 'enterprise' });
		const public_ = shownPrompts(COPILOT, { deploymentType: 'github.com' });

		expect(missingAnswer(enterprise, { deploymentType: 'enterprise', enterpriseUrl: '  ' })).toBe(true);
		expect(missingAnswer(public_, { deploymentType: 'github.com' })).toBe(false);
	});

	test('answers to prompts that no longer apply, and blanks, are not sent', () => {
		const answers = { deploymentType: 'github.com', enterpriseUrl: 'company.ghe.com', label: ' work ' };

		expect(answersFor(shownPrompts(COPILOT, answers), answers)).toEqual({
			deploymentType: 'github.com',
			label: 'work'
		});
	});
});

describe('pickGroups', () => {
	const all = [
		provider('zai', 'Z.AI'),
		provider('openai', 'OpenAI'),
		provider('acme'),
		provider('opencode', 'OpenCode')
	];

	test('lists popular providers first in their fixed order, then the rest', () => {
		expect(pickGroups(all, '').map((group) => [group.heading, group.items.map((item) => item.id)])).toEqual([
			['Popular', ['opencode', 'openai']],
			['All providers', ['zai', 'acme']]
		]);
	});

	test('a search matches name or id and keeps popular matches first', () => {
		expect(pickGroups(all, ' OPEN ').map((group) => group.items.map((item) => item.id))).toEqual([
			['opencode', 'openai']
		]);

		expect(pickGroups(all, 'z.ai')[0].items.map((item) => item.id)).toEqual(['zai']);
	});
});
