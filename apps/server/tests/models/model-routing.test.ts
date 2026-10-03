import { afterEach, expect, test } from 'bun:test';
import { configForAgent, configForOrchestrator, configForSubagent } from '../../src/models/models';
import { setReviewOverrides } from '../../src/review/session/review-settings';

afterEach(() => setReviewOverrides({}));

const models = [
	{
		id: 'sol',
		label: 'Sol',
		model: 'sol',
		provider: 'codex' as const,
		efforts: ['low', 'medium', 'high'] as ('low' | 'medium' | 'high')[]
	},
	{
		id: 'mini',
		label: 'Mini',
		model: 'mini',
		provider: 'codex' as const,
		efforts: ['minimal', 'low', 'medium', 'high'] as ('minimal' | 'low' | 'medium' | 'high')[]
	}
];

test('a subagent’s finding follows up on the second model, and every other agent’s on the Review model', () => {
	setReviewOverrides({
		models,
		orchestratorModelId: 'sol',
		orchestratorEffort: 'low',
		specialistModelId: 'mini',
		specialistEffort: 'high'
	});

	expect(configForAgent('subagent')).toMatchObject({ model: 'mini', reasoningEffort: 'high' });

	for (const agent of ['reviewer', 'orchestrator', 'security', undefined]) {
		expect(configForAgent(agent)).toMatchObject({ model: 'sol', reasoningEffort: 'low' });
	}
});

test('an unset second model follows the Review model and its effort', () => {
	setReviewOverrides({ models, orchestratorModelId: 'mini', orchestratorEffort: 'minimal' });
	expect(configForSubagent()).toMatchObject({ model: 'mini', reasoningEffort: 'minimal' });
});

test('an effort the model does not offer falls back to the model default', () => {
	setReviewOverrides({ models, orchestratorModelId: 'sol', orchestratorEffort: 'minimal' });
	expect(configForOrchestrator().reasoningEffort).toBe('medium');
});

test('an OpenCode model routes through OpenCode instead of the first saved model', () => {
	setReviewOverrides({ models, orchestratorModelId: 'opencode:openrouter/qwen/qwen3', orchestratorEffort: 'high' });

	expect(configForOrchestrator()).toMatchObject({
		provider: 'opencode',
		source: 'openrouter',
		model: 'openrouter/qwen/qwen3',
		reasoningEffort: 'high'
	});
});
