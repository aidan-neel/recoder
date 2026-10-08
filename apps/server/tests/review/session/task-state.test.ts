import { expect, test } from 'bun:test';
import type { ReviewTask } from '@recoder/shared';
import { settleTasks, unsettledTasks } from '../../../src/review/session/task-state';

const task = (id: string, status: ReviewTask['status'], message = id): ReviewTask => ({
	id,
	label: id,
	status,
	message,
	updatedAt: ''
});

const open = [task('fetch', 'done'), task('verify', 'running'), task('slot', 'waiting'), task('unit', 'queued')];

test('a complete review closes running work as partial and never-started work as skipped, each with its reason', () => {
	const settled = settleTasks(open, null);

	expect(settled.map((entry) => [entry.id, entry.status])).toEqual([
		['verify', 'partial'],
		['slot', 'partial'],
		['unit', 'skipped']
	]);

	expect(unsettledTasks([open[0]!, ...settled])).toEqual([]);
});

test('a failed or cancelled review fails all its open work with the reason it stopped', () => {
	expect(settleTasks(open, 'Review cancelled.').map((entry) => [entry.id, entry.status, entry.message])).toEqual([
		['verify', 'error', 'Review cancelled.'],
		['slot', 'error', 'Review cancelled.'],
		['unit', 'error', 'Review cancelled.']
	]);
});

test('a skipped task without a reason counts as unsettled', () => {
	expect(
		unsettledTasks([task('a', 'skipped', ' '), task('b', 'skipped', 'No checkout')]).map((entry) => entry.id)
	).toEqual(['a']);
});
