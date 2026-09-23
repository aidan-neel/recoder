import { afterEach, expect, test } from 'bun:test';
import { configForOrchestrator, configForRole } from './models';
import { setReviewOverrides } from './review-settings';

afterEach(() => setReviewOverrides({}));

const models = [
	{ id: 'sol', label: 'Sol', model: 'sol', provider: 'codex' as const, efforts: ['low', 'medium', 'high'] as ('low' | 'medium' | 'high')[] },
	{ id: 'mini', label: 'Mini', model: 'mini', provider: 'codex' as const, efforts: ['minimal', 'low', 'medium', 'high'] as ('minimal' | 'low' | 'medium' | 'high')[] }
];

test('orchestrator effort is independent of the correctness role', () => {
	setReviewOverrides({ models, orchestratorModelId: 'sol', orchestratorEffort: 'low', roleEfforts: { correctness: 'high' } });
	expect(configForOrchestrator()).toMatchObject({ model: 'sol', reasoningEffort: 'low' });
	expect(configForRole('correctness')).toMatchObject({ reasoningEffort: 'high' });
});

test('orchestrator falls back to the correctness effort saved before orchestrator effort existed', () => {
	setReviewOverrides({ models, orchestratorModelId: 'sol', roleEfforts: { correctness: 'high' } });
	expect(configForOrchestrator().reasoningEffort).toBe('high');
});

test('apply to all specialists routes every role to the orchestrator model and effort', () => {
	setReviewOverrides({
		models,
		orchestratorModelId: 'mini',
		orchestratorEffort: 'minimal',
		specialistModelId: 'sol',
		roles: { security: 'sol' },
		roleEfforts: { security: 'high' },
		applyToSpecialists: true
	});
	for (const role of ['security', 'perf', 'docs'] as const) {
		expect(configForRole(role)).toMatchObject({ role, model: 'mini', reasoningEffort: 'minimal' });
	}
});

test('an effort the model does not offer falls back to the model default', () => {
	setReviewOverrides({ models, orchestratorModelId: 'sol', orchestratorEffort: 'minimal' });
	expect(configForOrchestrator().reasoningEffort).toBe('medium');
});
