import { describe, expect, test } from 'bun:test';
import type { ModelSettings, MyModels } from '@recoder/shared';

import { minePick, picksPatch, pickSourceKind, settingsPatch } from '../../src/lib/settings/pick-source';

const settings = {
	sharedModelId: null,
	orchestratorModelId: 'admin-review',
	orchestratorEffort: 'high',
	specialistModelId: 'admin-sub',
	specialistEffort: null
} as ModelSettings;

const mine: MyModels = {
	orchestratorModelId: null,
	orchestratorEffort: null,
	specialistModelId: 'my-sub',
	specialistEffort: 'low',
	enforced: false
};

describe('pick source', () => {
	test('a member owns the Review and Subagent picks, never the Verifier pick', () => {
		expect(pickSourceKind('orchestrator', false)).toBe('mine');
		expect(pickSourceKind('specialist', false)).toBe('mine');
		expect(pickSourceKind('verifier', false)).toBe('settings');
	});

	test('the admin reads and saves every pick in the settings', () => {
		expect(pickSourceKind('orchestrator', true)).toBe('settings');

		expect(settingsPatch('verifier', { id: 'v', effort: null })).toEqual({
			verifierModelId: 'v',
			verifierEffort: null
		});
	});

	test('a member without a Review pick runs on the admin’s, effort included', () => {
		expect(minePick(settings, mine, 'orchestrator')).toEqual({ id: 'admin-review', effort: 'high' });
	});

	test('a member’s own Subagent pick wins, and an unset one stays unset', () => {
		expect(minePick(settings, mine, 'specialist')).toEqual({ id: 'my-sub', effort: 'low' });
		expect(minePick(settings, { ...mine, specialistModelId: null }, 'specialist').id).toBeNull();
	});

	test('a pick saves to its own fields of the member’s picks', () => {
		expect(picksPatch('specialist', { id: 'm', effort: 'medium' })).toEqual({
			specialistModelId: 'm',
			specialistEffort: 'medium'
		});
	});
});
