import { expect, test } from 'bun:test';
import { EXIT } from '../../../src/cli/exit';
import { childEnvironment, testDataDir } from '../child-env';
import { lineReader } from '../line-reader';
import { useFreshDataDir } from '../runs/run-fixtures';

const FIXTURE = new URL('./abort-fixture.ts', import.meta.url).pathname;

const SIGTERM_EXIT = 143;

useFreshDataDir();

/** Starts the fixture and returns a reader of its standard output, one line at a time. */
function startFixture(...args: string[]) {
	const child = Bun.spawn(['bun', FIXTURE, ...args], {
		env: childEnvironment(testDataDir()),
		stdout: 'pipe',
		stderr: 'pipe',
		stdin: 'ignore'
	});

	return { child, nextLine: lineReader(child.stdout) };
}

test('the first SIGTERM aborts the review and the process ends by itself as cancelled, not by the signal', async () => {
	const { child, nextLine } = startFixture();

	expect(await nextLine()).toBe('ready');

	child.kill('SIGTERM');

	expect(await nextLine()).toBe('aborted');
	expect(await child.exited).toBe(EXIT.cancelled);
});

test('a second signal ends the process at once with the signal code', async () => {
	const { child, nextLine } = startFixture('hold');

	expect(await nextLine()).toBe('ready');

	child.kill('SIGTERM');

	expect(await nextLine()).toBe('aborted');

	child.kill('SIGTERM');

	expect(await child.exited).toBe(SIGTERM_EXIT);
});
