import { afterEach, expect, test } from 'bun:test';
import { discoverModels, normalizeEndpoint } from '../../src/models/model-discovery';
import { fakeVllm } from '../helpers/fake-vllm';

let vllm: ReturnType<typeof fakeVllm> | null = null;

afterEach(() => vllm?.restore());

test('every way of writing a vLLM address names the same endpoint', () => {
	for (const pasted of [
		'vllm.test:8000',
		'http://vllm.test:8000/',
		'  http://vllm.test:8000  ',
		'http://vllm.test:8000/models'
	]) {
		expect(normalizeEndpoint(pasted)).toBe('http://vllm.test:8000');
	}

	expect(normalizeEndpoint('https://vllm.test/v1/models')).toBe('https://vllm.test/v1');
});

test('an address without /v1 is corrected to the one that lists models, and max_model_len is the context window', async () => {
	vllm = fakeVllm([{ id: 'qwen', len: 40960 }, { id: 'tiny' }]);

	const found = await discoverModels('vllm.test:8000');

	expect(found.baseUrl).toBe('http://vllm.test:8000/v1');

	expect(found.models).toEqual([
		{ id: 'qwen', contextWindow: 40960, ownedBy: 'vllm' },
		{ id: 'tiny', contextWindow: null, ownedBy: 'vllm' }
	]);
});
