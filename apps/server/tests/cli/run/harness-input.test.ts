import { expect, test } from 'bun:test';
import { harnessInput } from '../../../src/cli/run/harness-input';
import { fakeTarget, reviewOptions } from './run-fixtures';

const SETTINGS = {
	budget: 'medium' as const,
	subagents: 0,
	reviewerModel: 'm',
	workerModel: 'm',
	reviewerEffort: null,
	workerEffort: null,
	lenses: null,
	reportLowSeverity: false,
	exec: true,
	execReason: null
};

const signal = new AbortController().signal;

test('zero subagents and a false low-severity setting reach the harness as given, and no lens list means every lens', () => {
	const input = harnessInput({ options: reviewOptions(), target: fakeTarget().target, settings: SETTINGS, signal });

	expect(input.subagentCap).toBe(0);
	expect(input.reportLowSeverity).toBe(false);
	expect('lenses' in input).toBe(false);
	expect(input.repoId).toBeNull();
});

test('the caller title wins over the forge title and a missing one falls back to it', () => {
	const { target } = fakeTarget();
	const forged = { ...target, title: 'Forge title', body: 'Forge body' };
	const options = reviewOptions({ intent: { title: 'Mine', body: null, instructions: 'Look at auth' } });

	const input = harnessInput({ options, target: forged, settings: SETTINGS, signal });

	expect(input).toMatchObject({ prTitle: 'Mine', prBody: 'Forge body', instructions: 'Look at auth' });
});
