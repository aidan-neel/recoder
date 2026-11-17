import { DEFAULT_CONTEXT_WINDOW, type ModelEntry, type ModelSettings } from '@recoder/shared';
import { describe, expect, test } from 'bun:test';

import { contextWindowPick, pickedModelIds } from '../../src/lib/settings/context-windows';
import { modelSettings } from '../fixtures';

function entry(id: string, contextWindow?: number): ModelEntry {
	return { id, label: id, model: id, baseUrl: null, apiKeySet: false, contextWindow };
}

function settings(patch: Partial<ModelSettings>): ModelSettings {
	return modelSettings({ orchestratorModelId: null, specialistModelId: null, verifierModelId: null, ...patch });
}

describe('pickedModelIds', () => {
	test('lists each picked model once and adds nothing for picks that follow the Review model', () => {
		const picked = pickedModelIds(settings({ orchestratorModelId: 'terra', specialistModelId: 'terra' }));

		expect(picked).toEqual(['terra']);
	});

	test('falls back to the older shared pick when the Review pick is unset', () => {
		const picked = pickedModelIds(settings({ sharedModelId: 'shared', verifierModelId: 'luna' }));

		expect(picked).toEqual(['shared', 'luna']);
	});
});

describe('contextWindowPick', () => {
	test('runs on the set window over the reported one', () => {
		const pick = contextWindowPick(
			settings({ models: [entry('terra', 400_000)], contextWindows: { terra: 256_000 } }),
			'terra'
		);

		expect(pick).toMatchObject({ reported: 400_000, set: 256_000, effective: 256_000 });
	});

	test('runs on the default when no window is set or reported', () => {
		const pick = contextWindowPick(settings({ models: [entry('local')] }), 'local');

		expect(pick.effective).toBe(DEFAULT_CONTEXT_WINDOW);
	});
});
