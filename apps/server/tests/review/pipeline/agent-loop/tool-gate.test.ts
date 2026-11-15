import { expect, mock, test } from 'bun:test';
import { DEFAULT_CONTEXT_WINDOW } from '@recoder/shared';
import { EvidenceStore } from '../../../../src/evidence/evidence';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import { ModelBudget } from '../../../../src/review/pipeline/agent-loop/budget';
import { ToolGate, FINAL_TURN_NOTE } from '../../../../src/review/pipeline/agent-loop/tool-gate';

/** Real evidence with execution observed, so a refused call cannot hide a side effect. */
function fixture(final = false) {
	const evidence = new EvidenceStore(null, buildInventory(''), 12000);
	const execute = mock(evidence.executeRound.bind(evidence));

	evidence.executeRound = execute;

	const gate = new ToolGate(
		{
			label: 'reader',
			stage: 'reviewer',
			system: '',
			user: '',
			config: { model: 'fake', baseUrl: '', apiKey: '', contextWindow: DEFAULT_CONTEXT_WINDOW },
			budget: new ModelBudget(),
			evidence,
			maxTurns: 4,
			signal: new AbortController().signal,
			deadlineAt: Date.now() + 1000,
			parse: () => null
		},
		'reader',
		{ isFinal: () => final, nextIsFinal: () => false },
		''
	);

	return { gate, execute };
}

test('read-only roles refuse execution and delegation before running or counting them', async () => {
	const { gate, execute } = fixture();

	for (const name of ['run', 'write_file', 'delegate']) {
		expect(await gate.run(name, {})).toEqual({
			text: `Tool ${name} is not available to your role. Your tools: read_diff, read_file, search, list_files, load_skill.`,
			isError: true
		});
	}

	expect(execute).not.toHaveBeenCalled();
	expect(gate.retrievals).toBe(0);
	expect(gate.runs).toBe(0);
});

test('the final turn refuses even read tools before accessing evidence', async () => {
	const { gate, execute } = fixture(true);

	expect(await gate.run('read_diff', { path: 'a.ts' })).toEqual({ text: FINAL_TURN_NOTE, isError: true });
	expect(execute).not.toHaveBeenCalled();
});
