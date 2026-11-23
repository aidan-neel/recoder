import { expect, mock, test } from 'bun:test';
import { DEFAULT_CONTEXT_WINDOW } from '@recoder/shared';
import { EvidenceStore } from '../../../../src/evidence/evidence';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import { ModelBudget } from '../../../../src/review/pipeline/agent-loop/budget';
import { ToolGate, FINAL_TURN_NOTE } from '../../../../src/review/pipeline/agent-loop/tool-gate';
import { DIFF } from '../harness-fixtures';

/** Real evidence with execution observed, so a refused call cannot hide a side effect. */
function fixture(final = false, limit?: number, opaque = false) {
	const evidence = new EvidenceStore(null, buildInventory(DIFF), 12000);
	const execute = mock(evidence.executeRound.bind(evidence));
	const onExhausted = mock(() => {});

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
		'',
		limit === undefined ? undefined : { limit, onExhausted },
		opaque
	);

	return { gate, execute, onExhausted };
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

test('a session budget survives step resets and serializes concurrent operations before touching evidence', async () => {
	const { gate, execute, onExhausted } = fixture(false, 1);

	await gate.run('read_diff', {});
	expect(onExhausted).toHaveBeenCalledTimes(1);
	gate.stepDone();

	const refused = await Promise.all([gate.run('read_diff', {}), gate.run('read_diff', {})]);

	expect(execute).toHaveBeenCalledTimes(1);
	expect(refused.every((item) => item.isError)).toBe(true);
	expect(gate.ops).toBe(3);
	expect(gate.refusals).toBe(2);
	expect(gate.exhausted).toBe(true);
	expect(onExhausted).toHaveBeenCalled();
});

test('invalid tool requests also consume the session limit instead of permitting an endless refusal loop', async () => {
	const { gate, execute, onExhausted } = fixture(false, 2);

	await gate.run('unknown', {});
	await gate.run('unknown', {});

	expect(execute).not.toHaveBeenCalled();
	expect(gate.refusals).toBe(2);
	expect(gate.ops).toBe(2);
	expect(onExhausted).toHaveBeenCalledTimes(1);
});

test('the final turn refuses even read tools before accessing evidence', async () => {
	const { gate, execute } = fixture(true);

	expect(await gate.run('read_diff', { path: 'a.ts' })).toEqual({ text: FINAL_TURN_NOTE, isError: true });
	expect(execute).not.toHaveBeenCalled();
});

test('an opaque prompt can progress past four calls but cannot replenish its session allowance on retry', async () => {
	const { gate, execute } = fixture(false, 6, true);

	for (let index = 0; index < 5; index++)
		expect((await gate.run('read_diff', { path: 'src/a.ts' })).isError).toBe(false);
	gate.stepDone();
	expect((await gate.run('read_diff', { path: 'src/a.ts' })).isError).toBe(false);
	gate.stepDone();
	expect((await gate.run('read_diff', {})).isError).toBe(true);
	expect(execute).toHaveBeenCalledTimes(6);
	expect(gate.exhausted).toBe(true);
});

test('adapters with real step boundaries still apply the per-step allowance', async () => {
	const { gate, execute } = fixture(false, 20);

	for (let index = 0; index < 4; index++) await gate.run('read_diff', { path: 'src/a.ts' });
	expect((await gate.run('read_diff', {})).isError).toBe(true);
	gate.stepDone();
	expect((await gate.run('read_diff', { path: 'src/a.ts' })).isError).toBe(false);
	expect(execute).toHaveBeenCalledTimes(5);
});
