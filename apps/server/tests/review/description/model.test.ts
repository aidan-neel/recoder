import { afterEach, expect, test } from 'bun:test';
import { descriptionModel } from '../../../src/review/description/model';
import { getStoredSettings, setReviewOverrides } from '../../../src/review/session/review-settings';

const original = getStoredSettings();

const settings = {
	baseUrl: 'http://description-model.test/v1',
	models: [
		{ id: 'review', label: 'GPT-6 Luna', model: 'gpt-6-luna', efforts: ['high', 'minimal'] as const },
		{ id: 'worker', label: 'xai/grok-4.6', model: 'grok-4.6', efforts: ['high', 'low'] as const }
	].map((entry) => ({ ...entry, efforts: [...entry.efforts] })),
	orchestratorModelId: 'review',
	orchestratorEffort: 'high',
	specialistModelId: 'worker',
	specialistEffort: 'high'
} as const;

afterEach(() => setReviewOverrides(original));

test('the worker pick uses its lowest offered effort instead of the saved effort or first listed effort', () => {
	setReviewOverrides(settings);

	expect(descriptionModel()).toMatchObject({
		model: { id: 'worker', label: 'Grok 4.6', effort: 'low' },
		config: { model: 'grok-4.6', reasoningEffort: 'low' }
	});
});

test('a CLI worker falls back to the Review chat endpoint at its lowest effort', () => {
	setReviewOverrides({ ...settings, specialistModelId: 'codex:gpt-6-luna' });

	expect(descriptionModel()).toMatchObject({
		model: { id: 'review', label: 'GPT-6 Luna', effort: 'minimal' },
		config: { model: 'gpt-6-luna', reasoningEffort: 'minimal' }
	});
});

test('a model with no advertised efforts does not inherit a saved effort', () => {
	setReviewOverrides({
		...settings,
		models: settings.models.map((entry) => ({ ...entry, efforts: undefined }))
	});

	const pick = descriptionModel();

	expect(pick?.model.effort).toBeNull();
	expect(pick?.config.reasoningEffort).toBeUndefined();
});

test('two CLI picks do not configure a description model', () => {
	setReviewOverrides({
		orchestratorModelId: 'codex:gpt-6-luna',
		specialistModelId: 'opencode:xai/grok-4.6'
	});

	expect(descriptionModel()).toBeNull();
});
