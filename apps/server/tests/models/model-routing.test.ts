import { afterEach, expect, test } from 'bun:test';
import { DEFAULT_CONTEXT_WINDOW } from '@recoder/shared';
import {
	contextWindowFor,
	configForAgent,
	configForOrchestrator,
	configForSubagent,
	configForVerifier,
	hasSeparateSpecialist,
	isReviewConfigured,
	isReviewRunnable,
	ProviderSwitchedOffError,
	stageConfigs,
	withLockedModels
} from '../../src/models/models';
import { setReviewOverrides } from '../../src/review/session/review-settings';

afterEach(() => setReviewOverrides({}));

const models = [
	{
		id: 'sol',
		label: 'Sol',
		model: 'sol',
		provider: 'openai-compatible' as const,
		baseUrl: 'http://localhost:8000/v1',
		efforts: ['low', 'medium', 'high'] as ('low' | 'medium' | 'high')[]
	},
	{
		id: 'mini',
		label: 'Mini',
		model: 'mini',
		provider: 'openai-compatible' as const,
		baseUrl: 'http://localhost:8000/v1',
		efforts: ['minimal', 'low', 'medium', 'high'] as ('minimal' | 'low' | 'medium' | 'high')[]
	},
	{
		id: 'judge',
		label: 'Judge',
		model: 'judge',
		provider: 'openai-compatible' as const,
		baseUrl: 'http://localhost:8000/v1',
		efforts: ['low', 'medium', 'high'] as ('low' | 'medium' | 'high')[]
	}
];

test('a subagent’s finding follows up on the second model, a verifier’s on the verifier model, and every other agent’s on the Review model', () => {
	setReviewOverrides({
		models,
		orchestratorModelId: 'sol',
		orchestratorEffort: 'low',
		specialistModelId: 'mini',
		specialistEffort: 'high',
		verifierModelId: 'judge',
		verifierEffort: 'medium'
	});

	expect(configForAgent('subagent')).toMatchObject({ model: 'mini', reasoningEffort: 'high' });
	expect(configForAgent('verifier')).toMatchObject({ model: 'judge', reasoningEffort: 'medium' });

	for (const agent of ['reviewer', 'orchestrator', 'security', undefined]) {
		expect(configForAgent(agent)).toMatchObject({ model: 'sol', reasoningEffort: 'low' });
	}
});

test('an unset second or verifier model follows the Review model and its effort, while verifierEffort can override effort alone', () => {
	setReviewOverrides({ models, orchestratorModelId: 'mini', orchestratorEffort: 'minimal', specialistModelId: 'sol' });
	expect(configForVerifier()).toMatchObject({ model: 'mini', reasoningEffort: 'minimal' });

	setReviewOverrides({ models, orchestratorModelId: 'mini', orchestratorEffort: 'minimal' });
	expect(configForSubagent()).toMatchObject({ model: 'mini', reasoningEffort: 'minimal' });

	setReviewOverrides({ models, orchestratorModelId: 'sol', orchestratorEffort: 'low', verifierEffort: 'high' });
	expect(configForVerifier()).toMatchObject({ model: 'sol', reasoningEffort: 'high' });
});

test('an effort the model does not offer falls back to the model default', () => {
	setReviewOverrides({ models, orchestratorModelId: 'sol', orchestratorEffort: 'minimal' });
	expect(configForOrchestrator().reasoningEffort).toBe('medium');
});

test('a saved entry carries its reported context window, the user’s set window over it, else the default', () => {
	const base = {
		label: 'Sol',
		model: 'sol',
		provider: 'openai-compatible' as const,
		baseUrl: 'http://localhost:8000/v1'
	};

	setReviewOverrides({ models: [{ ...base, id: 'sol', contextWindow: 32_000 }], orchestratorModelId: 'sol' });
	expect(configForOrchestrator().contextWindow).toBe(32_000);

	setReviewOverrides({
		models: [{ ...base, id: 'sol', contextWindow: 32_000 }],
		orchestratorModelId: 'sol',
		contextWindows: { sol: 16_000 }
	});

	expect(configForOrchestrator().contextWindow).toBe(16_000);

	setReviewOverrides({ models: [{ ...base, id: 'sol' }], orchestratorModelId: 'sol' });
	expect(configForOrchestrator().contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
});

test('an agent model carries the window its list reports, with the user’s set window over it', () => {
	setReviewOverrides({ orchestratorModelId: 'claude-code:claude-haiku-4-5-20251001' });
	expect(configForOrchestrator()).toMatchObject({ provider: 'claude-code', contextWindow: 200_000 });

	setReviewOverrides({ orchestratorModelId: 'claude-code:opus' });
	expect(configForOrchestrator().contextWindow).toBe(1_000_000);

	setReviewOverrides({ orchestratorModelId: 'claude-code:opus', contextWindows: { 'claude-code:opus': 400_000 } });
	expect(configForOrchestrator().contextWindow).toBe(400_000);
});

test('the context window takes the user’s setting over what the provider reports, over the default', () => {
	expect(contextWindowFor('m', 32_000)).toEqual({ tokens: 32_000, source: 'reported' });

	setReviewOverrides({ contextWindows: { m: 16_000 } });
	expect(contextWindowFor('m', 32_000)).toEqual({ tokens: 16_000, source: 'set' });

	setReviewOverrides({});
	expect(contextWindowFor('m', null)).toEqual({ tokens: DEFAULT_CONTEXT_WINDOW, source: 'default' });
	expect(contextWindowFor(undefined, 32_000)).toEqual({ tokens: 32_000, source: 'reported' });
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

test('a review keeps the models picked when it started while the picks change and another review runs', async () => {
	setReviewOverrides({ models, orchestratorModelId: 'sol', specialistModelId: 'mini', verifierModelId: 'judge' });

	const first = withLockedModels(async () => {
		await Bun.sleep(5);

		return [configForOrchestrator().model, configForSubagent().model, configForVerifier().model];
	});

	setReviewOverrides({ models, orchestratorModelId: 'mini', specialistModelId: 'sol', verifierModelId: 'sol' });

	const second = withLockedModels(async () => {
		await Bun.sleep(1);

		return [configForOrchestrator().model, configForSubagent().model, configForVerifier().model];
	});

	expect(await Promise.all([first, second])).toEqual([
		['sol', 'mini', 'judge'],
		['mini', 'sol', 'sol']
	]);
});

test('workers are offered only when the second model or its effort differs from Review', () => {
	setReviewOverrides({ models, orchestratorModelId: 'sol', orchestratorEffort: 'high' });
	expect(hasSeparateSpecialist()).toBe(false);

	setReviewOverrides({
		models,
		orchestratorModelId: 'sol',
		orchestratorEffort: 'high',
		specialistModelId: 'sol',
		specialistEffort: 'high'
	});

	expect(hasSeparateSpecialist()).toBe(false);

	setReviewOverrides({
		models,
		orchestratorModelId: 'sol',
		orchestratorEffort: 'high',
		specialistModelId: 'sol',
		specialistEffort: 'low'
	});

	expect(hasSeparateSpecialist()).toBe(true);

	setReviewOverrides({ models, orchestratorModelId: 'sol', specialistModelId: 'mini' });
	expect(hasSeparateSpecialist()).toBe(true);
});

test('a review whose verifier runs on a switched-off agent CLI fails before any call, naming it and where to switch it on', () => {
	setReviewOverrides({
		models,
		orchestratorModelId: 'sol',
		verifierModelId: 'codex:gpt-6-sol',
		disabledProviders: ['cli:codex']
	});

	expect(() => withLockedModels(stageConfigs)).toThrow('Codex is switched off in Settings → Providers.');
});

test('a chat on a model OpenCode routes to a switched-off provider fails before it starts', () => {
	setReviewOverrides({
		orchestratorModelId: 'opencode:openrouter/qwen/qwen3',
		disabledProviders: ['opencode:openrouter']
	});

	expect(configForOrchestrator).toThrow(ProviderSwitchedOffError);
});

test('a pick on a switched-off provider still counts as configured, but no review can run on it', () => {
	setReviewOverrides({ models, orchestratorModelId: 'claude-code:opus', disabledProviders: ['cli:claude-code'] });

	expect([isReviewConfigured(), isReviewRunnable()]).toEqual([true, false]);
});
