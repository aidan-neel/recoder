import { expect, test } from 'bun:test';
import { EvidenceStore } from '../../../../src/evidence/evidence';
import type { RetrievalAction } from '../../../../src/evidence/types';
import { ModelBudget } from '../../../../src/review/pipeline/agent-loop';
import { executeTurn } from '../../../../src/review/pipeline/agent-loop/delegation';
import { buildInventory } from '../../../../src/review/pipeline/inventory';

const diff = ['a', 'b']
	.map((name) => `diff --git a/${name}.ts b/${name}.ts\n--- a/${name}.ts\n+++ b/${name}.ts\n@@ -1 +1 @@\n-old\n+new\n`)
	.join('');

test('a turn that mixes reads and a delegation returns results in the order they were asked', async () => {
	const actions: RetrievalAction[] = [
		{ action: 'readDiff', path: 'a.ts' },
		{ action: 'delegate', task: 'Find callers' },
		{ action: 'readDiff', path: 'b.ts' }
	];

	const results = await executeTurn(
		{
			label: 'correctness',
			stage: 'reviewer',
			system: '',
			user: '',
			config: { model: 'test', baseUrl: 'https://model.test', apiKey: 'test' },
			budget: new ModelBudget(),
			evidence: new EvidenceStore(null, buildInventory(diff), 12000),
			maxTurns: 4,
			signal: new AbortController().signal,
			deadlineAt: Date.now() + 60_000,
			parse: () => null,
			delegate: async () => ({ action: 'delegate', ok: true, content: 'worker answer', truncated: false, runs: 2 })
		},
		actions,
		'agent_test'
	);

	expect(results.map((result) => result.path ?? result.content)).toEqual(['a.ts', 'worker answer', 'b.ts']);
});
