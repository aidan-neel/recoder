import { afterEach, expect, test } from 'bun:test';
import { providerSwitches } from '../../src/models/provider-switches';
import { setReviewOverrides } from '../../src/review/session/review-settings';

afterEach(() => setReviewOverrides({}));

/** Models of two agent CLIs, of two providers OpenCode routes to, of a vLLM server and of a saved endpoint. */
const MODELS = [
	{ id: 'codex:gpt-6-sol' },
	{ id: 'claude-code:opus' },
	{ id: 'opencode:anthropic/claude-sonnet' },
	{ id: 'opencode:openrouter/qwen/qwen3' },
	{ id: 'vllm:box/qwen' },
	{ id: 'saved-endpoint' }
];

/** The ids of the models the pickers may offer while `disabledProviders` are switched off. */
function offeredIds(disabledProviders: string[]): string[] {
	setReviewOverrides({ disabledProviders });

	return providerSwitches()
		.onlySwitchedOn(MODELS)
		.map((model) => model.id);
}

test('a switched-off agent CLI hides its own models and no others', () => {
	expect(offeredIds(['cli:codex'])).toEqual([
		'claude-code:opus',
		'opencode:anthropic/claude-sonnet',
		'opencode:openrouter/qwen/qwen3',
		'vllm:box/qwen',
		'saved-endpoint'
	]);
});

test('a switched-off OpenCode provider hides only the OpenCode models routed to it', () => {
	expect(offeredIds(['opencode:anthropic'])).toEqual([
		'codex:gpt-6-sol',
		'claude-code:opus',
		'opencode:openrouter/qwen/qwen3',
		'vllm:box/qwen',
		'saved-endpoint'
	]);
});

test('switching OpenCode off hides every OpenCode model, whichever provider it routes to', () => {
	expect(offeredIds(['cli:opencode'])).toEqual([
		'codex:gpt-6-sol',
		'claude-code:opus',
		'vllm:box/qwen',
		'saved-endpoint'
	]);
});

test('a model whose agent and provider are both off names the agent CLI as the provider to switch on', () => {
	setReviewOverrides({ disabledProviders: ['cli:opencode', 'opencode:anthropic'] });

	expect(providerSwitches().offProviderOf('opencode:anthropic/claude-sonnet')).toEqual({ kind: 'cli', id: 'opencode' });
});
