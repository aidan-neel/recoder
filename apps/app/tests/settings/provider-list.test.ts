import { describe, expect, test } from 'bun:test';
import type { AgentAuthMethod, AgentProvider } from '@recoder/shared';

import { focusTarget } from '../../src/lib/settings/providers/use-provider-list';

function provider(id: string, patch: Partial<AgentProvider> = {}): AgentProvider {
	return {
		id,
		name: id,
		modelCount: 1,
		connected: true,
		via: 'key',
		removable: true,
		methods: [],
		...patch
	};
}

const oauth: AgentAuthMethod = { index: 0, type: 'oauth', label: 'Sign in', prompts: [] };

const rows = [
	provider('a'),
	provider('b', { removable: false, via: 'env' }),
	provider('c', { removable: false, via: 'builtin', methods: [oauth] }),
	provider('d')
];

describe('where focus lands after a disconnect', () => {
	test('the next row with a control wins, skipping rows that have none', () => {
		expect(focusTarget(rows, rows[0])).toBe('c');
	});

	test('with none after, the closest one before', () => {
		expect(focusTarget(rows, rows[3])).toBe('c');
	});

	test('a removed row no longer in the list still lands on the first control', () => {
		expect(focusTarget([provider('x', { removable: false }), provider('y')], provider('gone'))).toBe('y');
	});

	test('no control left focuses Add provider', () => {
		expect(focusTarget([provider('x', { removable: false, via: 'env' })], provider('x', { removable: false }))).toBe(
			'add'
		);
	});
});
