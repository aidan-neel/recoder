import { describe, expect, test } from 'bun:test';
import type { ModelSettings } from '@recoder/shared';

import { enforcedFromSettings, withEnforcedPick } from '../../src/lib/settings/model-policy';

const settings = {
	sharedModelId: null,
	orchestratorModelId: 'admin-review',
	orchestratorEffort: 'high',
	specialistModelId: null,
	specialistEffort: null
} as ModelSettings;

describe('model policy', () => {
	test('setting members’ models starts from the admin’s own picks', () => {
		expect(enforcedFromSettings(settings)).toEqual({
			kind: 'enforced',
			orchestratorModelId: 'admin-review',
			orchestratorEffort: 'high',
			specialistModelId: null,
			specialistEffort: null
		});
	});

	test('a pick changes only its own fields of the enforced policy', () => {
		const next = withEnforcedPick(enforcedFromSettings(settings), 'specialist', { id: 'sub', effort: 'low' });

		expect(next).toMatchObject({
			orchestratorModelId: 'admin-review',
			specialistModelId: 'sub',
			specialistEffort: 'low'
		});
	});

	test('a pick leaves a policy that lets members choose as it is', () => {
		expect(withEnforcedPick({ kind: 'choose' }, 'specialist', { id: 'sub', effort: null })).toEqual({ kind: 'choose' });
	});
});
