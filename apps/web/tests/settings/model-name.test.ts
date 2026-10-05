import { expect, test } from 'bun:test';
import { looksLikeModelId, prettyModelName } from '../../src/lib/settings/model-name';

test('model ids read as product names', () => {
	expect(prettyModelName('glm-5.3-flash')).toBe('GLM 5.3 Flash');
	expect(prettyModelName('zai-org/GLM-5.3-Flash')).toBe('GLM 5.3 Flash');
	expect(prettyModelName('gpt-5-codex')).toBe('GPT 5 Codex');
	expect(prettyModelName('gpt-oss-120b')).toBe('GPT OSS 120B');
	expect(prettyModelName('qwen3-coder')).toBe('Qwen3 Coder');
	expect(prettyModelName('Qwen/qwen3-coder-30b-a3b')).toBe('Qwen3 Coder 30B A3B');
	expect(prettyModelName('moonshotai/kimi-k2')).toBe('Kimi K2');
	expect(prettyModelName('deepseek-v3.1')).toBe('DeepSeek V3.1');
	expect(prettyModelName('minimax-m2')).toBe('MiniMax M2');
});

test('split version numbers join and release dates drop', () => {
	expect(prettyModelName('anthropic/claude-haiku-4-5-20251001')).toBe('Claude Haiku 4.5');
	expect(prettyModelName('meta-llama/llama-3-1-8b')).toBe('Llama 3.1 8B');
});

test('an OpenRouter variant suffix is dropped', () => {
	expect(prettyModelName('deepseek/deepseek-r1:free')).toBe('DeepSeek R1');
});

test('only labels without spaces count as raw ids', () => {
	expect(looksLikeModelId('glm-5.3-flash')).toBe(true);
	expect(looksLikeModelId('GPT 5.6 Sol')).toBe(false);
	expect(looksLikeModelId('Ornith')).toBe(false);
});
