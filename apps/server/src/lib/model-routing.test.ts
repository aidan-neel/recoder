import { afterEach, expect, test } from 'bun:test';
import { configForOrchestrator, configForRole } from './models';
import { setReviewOverrides } from './review-settings';

afterEach(() => setReviewOverrides({}));

const models = [
	{ id: 'sol', label: 'Sol', model: 'sol', provider: 'codex' as const, efforts: ['low', 'medium', 'high'] as ('low' | 'medium' | 'high')[] },
	{ id: 'mini', label: 'Mini', model: 'mini', provider: 'codex' as const, efforts: ['minimal', 'low', 'medium', 'high'] as ('minimal' | 'low' | 'medium' | 'high')[] }
];

test('every specialist runs on the one Specialist model and effort', () => {
	setReviewOverrides({ models, orchestratorModelId: 'sol', orchestratorEffort: 'low', specialistModelId: 'mini', specialistEffort: 'high' });
	expect(configForOrchestrator()).toMatchObject({ model: 'sol', reasoningEffort: 'low' });
	for (const role of ['correctness', 'security', 'docs'] as const) {
		expect(configForRole(role)).toMatchObject({ role, model: 'mini', reasoningEffort: 'high' });
	}
});

test('an unset Specialist model follows the Review model and its effort', () => {
	setReviewOverrides({ models, orchestratorModelId: 'mini', orchestratorEffort: 'minimal' });
	expect(configForRole('security')).toMatchObject({ model: 'mini', reasoningEffort: 'minimal' });
});

test('an effort the model does not offer falls back to the model default', () => {
	setReviewOverrides({ models, orchestratorModelId: 'sol', orchestratorEffort: 'minimal' });
	expect(configForOrchestrator().reasoningEffort).toBe('medium');
});
