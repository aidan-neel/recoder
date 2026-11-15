import { expect, test } from 'bun:test';
import { openCodeConfigContent } from '../../../src/agents/opencode/opencode-config';

test('context overrides merge into existing model limits without replacing other configuration', () => {
	const existing = {
		mcp: { tools: { type: 'remote', url: 'http://localhost:1234' } },
		provider: {
			openai: {
				options: { baseURL: 'http://localhost:8000' },
				models: {
					'gpt-6.1-terra': { name: 'Terra', limit: { context: 128000, output: 8000 } },
					other: { limit: { context: 32000 } }
				}
			}
		}
	};

	const content = openCodeConfigContent(JSON.stringify(existing), {
		'opencode:openai/gpt-6.1-terra': 16000,
		'opencode:anthropic/claude': 200000,
		'vllm:local/model': 64000
	});

	expect(JSON.parse(content ?? '')).toEqual({
		...existing,
		provider: {
			openai: {
				...existing.provider.openai,
				models: {
					...existing.provider.openai.models,
					'gpt-6.1-terra': { name: 'Terra', limit: { context: 16000, output: 8000 } }
				}
			},
			anthropic: { models: { claude: { limit: { context: 200000 } } } }
		}
	});
});
