import { expect, test } from 'bun:test';
import { runCommand } from '../../src/commands/runner';

test('a stop ends a command that is running, and the run is recorded as killed', async () => {
	const controller = new AbortController();

	const run = await runCommand({
		command: 'bun',
		args: ['-e', "console.log('started'); setInterval(() => {}, 60_000);"],
		signal: controller.signal,
		onOutput: () => controller.abort()
	});

	expect(run.status).toBe('killed');
});

test('a command given a stop that already happened is killed at once', async () => {
	const run = await runCommand({
		command: 'bun',
		args: ['-e', 'setInterval(() => {}, 60_000);'],
		signal: AbortSignal.abort()
	});

	expect(run.status).toBe('killed');
});
