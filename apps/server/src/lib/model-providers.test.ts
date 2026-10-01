import { expect, test } from 'bun:test';
import { parseModelsDev, parseOpenRouter } from './model-providers';

test('models.dev models served over another API are marked unsupported', () => {
	const models = parseModelsDev({
		'opencode-go': {
			npm: '@ai-sdk/openai-compatible',
			models: {
				'glm-5.2': { id: 'glm-5.2', name: 'GLM-5.2', limit: { context: 1_000_000 }, cost: { input: 1.4 } },
				'grok-4.7': { id: 'grok-4.7', name: 'Grok 4.7', provider: { npm: '@ai-sdk/openai' } },
				'minimax-m3': { id: 'minimax-m3', name: 'MiniMax M3', provider: { npm: '@ai-sdk/anthropic' } }
			}
		}
	}, 'opencode-go');
	expect(models.map((m) => [m.id, m.supported])).toEqual([['glm-5.2', true], ['grok-4.7', false], ['minimax-m3', false]]);
	expect(models[0]).toMatchObject({ contextWindow: 1_000_000, inputCost: 1.4 });
});

test('a missing models.dev provider yields no models instead of throwing', () => {
	expect(parseModelsDev({}, 'opencode-go')).toEqual([]);
	expect(parseModelsDev(null, 'opencode-go')).toEqual([]);
});

test('OpenRouter per-token prices become per-million and junk rows are skipped', () => {
	const models = parseOpenRouter({ data: [
		{ id: 'qwen/qwen3-coder', name: 'Qwen: Qwen3 Coder', context_length: 262144, pricing: { prompt: '0.0000004' } },
		{ name: 'no id' },
		{ id: 'free/model', pricing: { prompt: 'n/a' } }
	] });
	expect(models).toEqual([
		{ id: 'qwen/qwen3-coder', name: 'Qwen3 Coder', contextWindow: 262144, inputCost: 0.4, supported: true },
		{ id: 'free/model', name: 'free/model', contextWindow: null, inputCost: null, supported: true }
	]);
});

test('OpenRouter reasoning efforts keep known levels in ascending order with a valid default', () => {
	const [model] = parseOpenRouter({ data: [
		{ id: 'deepseek/deepseek-v4-flash', reasoning: { supported_efforts: ['max', 'high', 'turbo', 'low'], default_effort: 'high' } }
	] });
	expect(model.efforts).toEqual(['low', 'high', 'max']);
	expect(model.defaultEffort).toBe('high');
	const [plain] = parseOpenRouter({ data: [{ id: 'mistralai/mistral-nemo', reasoning: { supported_efforts: [], default_effort: 'high' } }] });
	expect(plain.efforts).toBeUndefined();
	expect(plain.defaultEffort).toBeUndefined();
});
