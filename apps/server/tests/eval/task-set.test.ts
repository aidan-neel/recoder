import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTaskSet, selectTasks, type TaskSet } from '../../src/eval/task-set';

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

test('a set name that could leave sets/ or pass for the full set is refused, as is a file naming another set', () => {
	mkdirSync(join(dir, 'sets'));
	writeFileSync(join(dir, 'sets', 'quick.json'), JSON.stringify(quick));
	writeFileSync(join(dir, 'sets', 'other.json'), JSON.stringify(quick));

	expect(readTaskSet(dir, 'quick')).toEqual(quick);
	expect(() => readTaskSet(dir, 'other')).toThrow('names the task set quick, not other.');

	for (const name of ['../labels/hono-1', 'full', 'only', 'Quick'])
		expect(() => readTaskSet(dir, name)).toThrow('lowercase letters, digits and dashes');
});
