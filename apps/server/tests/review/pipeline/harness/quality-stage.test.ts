import { afterEach, describe, expect, test } from 'bun:test';
import { createRun } from '../../../../src/review/pipeline/harness/context';
import { diagnosticStage } from '../../../../src/review/pipeline/harness/quality-stage';
import { DIFF } from '../harness-fixtures';

const original = process.env.RECODER_TEST_STRENGTH;

afterEach(() => {
	if (original === undefined) delete process.env.RECODER_TEST_STRENGTH;
	else process.env.RECODER_TEST_STRENGTH = original;
});

/** Runs the diagnostic stage on a checkout-less run and returns the ids of the tasks it reported. */
async function tasksReported(detectors: Promise<void>, strength: boolean): Promise<string[]> {
	if (strength) process.env.RECODER_TEST_STRENGTH = '1';
	else delete process.env.RECODER_TEST_STRENGTH;

	const tasks: string[] = [];
	const run = createRun({ diff: DIFF, sandboxPath: null }, { onTask: (task) => tasks.push(task.id) });

	await diagnosticStage(run, () => false, detectors);

	return tasks;
}

describe('diagnosticStage', () => {
	test('with the test-strength work off it does not wait for the detectors', async () => {
		expect(await tasksReported(new Promise(() => {}), false)).not.toContain('matrix');
	});

	test('with the test-strength work off a rejected detectors promise does not fail it', async () => {
		expect(await tasksReported(Promise.reject(new Error('detectors failed')), false)).not.toContain('matrix');
	});

	test('with the test-strength work on a rejected detectors promise skips the matrix and does not fail it', async () => {
		expect(await tasksReported(Promise.reject(new Error('detectors failed')), true)).not.toContain('matrix');
	});

	test('with the test-strength work on it runs the matrix once the detectors are done', async () => {
		expect(await tasksReported(Promise.resolve(), true)).toContain('matrix');
	});
});
