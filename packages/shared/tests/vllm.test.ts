import { expect, test } from 'bun:test';

import { parseVllmModelId, vllmModelId } from '../src/vllm';

test('a vLLM model id round-trips even when the model id has slashes and colons', () => {
	const id = vllmModelId('v1a2b3c4d', 'org/Qwen3-Coder:30b/instruct');

	expect(parseVllmModelId(id)).toEqual({ serverId: 'v1a2b3c4d', model: 'org/Qwen3-Coder:30b/instruct' });
});

test('an id from another agent, or one with no model, is not a vLLM id', () => {
	expect(parseVllmModelId('opencode:openai/gpt-5')).toBeNull();
	expect(parseVllmModelId('vllm:v1a2b3c4d/')).toBeNull();
	expect(parseVllmModelId('vllm:/model')).toBeNull();
});
