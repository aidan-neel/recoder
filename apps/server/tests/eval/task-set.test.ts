import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOLDOUT_SET, readLabels, readTaskSet, selectTasks, type TaskSet } from '../../src/eval/task-set';

const dir = mkdtempSync(join(tmpdir(), 'recoder-task-set-'));
const labels = [{ id: 'hono-1' }, { id: 'hono-1-control' }, { id: 'ky-2' }];

const quick: TaskSet = {
	name: 'quick',
	tasks: ['ky-2', 'hono-1-control'],
	sources: ['a.json'],
	selectedAt: '2026-10-06T00:00:00.000Z',
	rule: 'test'
};

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

test('a set chooses its PRs and names itself; no choice is the full set and --only is its own set', () => {
	expect(selectTasks(labels, { only: null, set: quick })).toEqual({
		name: 'quick',
		labels: [{ id: 'hono-1-control' }, { id: 'ky-2' }]
	});

	expect(selectTasks(labels, { only: null, set: null })).toEqual({ name: 'full', labels });
	expect(selectTasks(labels, { only: ['hono-1'], set: null })).toEqual({ name: 'only', labels: [{ id: 'hono-1' }] });
});

test('--only with --set is refused, and so is a set naming a PR the dataset has no labels for', () => {
	expect(() => selectTasks(labels, { only: ['hono-1'], set: quick })).toThrow(
		'--only and --set each choose the tasks; pass one.'
	);

	expect(() => selectTasks(labels, { only: null, set: { ...quick, tasks: ['ky-2', 'ky-9'] } })).toThrow(
		'Task set quick names PRs the dataset has no labels for: ky-9.'
	);
});

test('the full set leaves holdout labels out, and --set holdout reviews only them', () => {
	const marked = [
		{ id: 'hono-1' },
		{ id: 'hono-1-control' },
		{ id: 'ky-2', holdout: true },
		{ id: 'ky-2-control', holdout: true }
	];

	expect(selectTasks(marked, { only: null, set: null })).toEqual({
		name: 'full',
		labels: [{ id: 'hono-1' }, { id: 'hono-1-control' }]
	});

	expect(selectTasks(marked, { only: null, set: HOLDOUT_SET })).toEqual({
		name: 'holdout',
		labels: [
			{ id: 'ky-2', holdout: true },
			{ id: 'ky-2-control', holdout: true }
		]
	});
});

test('--only and a written set can still name holdout labels on purpose', () => {
	const marked = [{ id: 'ky-2', holdout: true }, { id: 'hono-1' }];

	expect(selectTasks(marked, { only: ['ky-2'], set: null })).toEqual({
		name: 'only',
		labels: [{ id: 'ky-2', holdout: true }]
	});

	expect(selectTasks(marked, { only: null, set: { ...quick, tasks: ['ky-2'] } })).toEqual({
		name: 'quick',
		labels: [{ id: 'ky-2', holdout: true }]
	});
});

test('a dataset with no holdout labels refuses the holdout set', () => {
	expect(() => selectTasks(labels, { only: null, set: HOLDOUT_SET })).toThrow(
		'Task set holdout: the dataset marks no label holdout.'
	);
});

test('a dataset whose labels are all holdout refuses the default full set', () => {
	expect(() => selectTasks([{ id: 'ky-2', holdout: true }], { only: null, set: null })).toThrow(
		'Every label is marked holdout'
	);
});

test('label files load with or without the holdout mark, and a non-boolean mark is refused', () => {
	const datasetDir = join(dir, 'dataset');

	mkdirSync(join(datasetDir, 'labels'), { recursive: true });
	writeFileSync(join(datasetDir, 'labels', 'a-1.json'), JSON.stringify({ id: 'a-1', codebase: 'a' }));
	writeFileSync(join(datasetDir, 'labels', 'b-1.json'), JSON.stringify({ id: 'b-1', codebase: 'b', holdout: true }));

	expect(readLabels(datasetDir).map((label) => label.holdout)).toEqual([undefined, true]);

	writeFileSync(join(datasetDir, 'labels', 'c-1.json'), JSON.stringify({ id: 'c-1', holdout: 'yes' }));

	expect(() => readLabels(datasetDir)).toThrow('invalid label file');
});

test('a set name that could leave sets/ or pass for a built-in set is refused, as is a file naming another set', () => {
	mkdirSync(join(dir, 'sets'));
	writeFileSync(join(dir, 'sets', 'quick.json'), JSON.stringify(quick));
	writeFileSync(join(dir, 'sets', 'other.json'), JSON.stringify(quick));

	expect(readTaskSet(dir, 'quick')).toEqual(quick);
	expect(() => readTaskSet(dir, 'other')).toThrow('names the task set quick, not other.');

	for (const name of ['../labels/hono-1', 'full', 'only', 'holdout', 'Quick'])
		expect(() => readTaskSet(dir, name)).toThrow('lowercase letters, digits and dashes');
});
