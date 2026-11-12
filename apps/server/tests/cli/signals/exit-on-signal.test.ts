import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { exitOnSignalAfter, signalExitCode } from '../../../src/cli/signals/exit-on-signal';

/** The stop listeners other tests left on this process, set aside so only the ones under test hear the stop. */
let others: ((signal: 'SIGTERM') => void)[] = [];

beforeEach(() => {
	others = process.listeners('SIGTERM');
	process.removeAllListeners('SIGTERM');
});

afterEach(() => {
	process.removeAllListeners('SIGTERM');

	for (const listener of others) process.on('SIGTERM', listener);
});

/** Stands in for `process.exit`, which would end the test run. */
function exitSpy() {
	return spyOn(process, 'exit').mockImplementation(() => undefined as never);
}

test('a stop that arrives during the write ends the process only once the write is done', async () => {
	const exit = exitSpy();
	const write = Promise.withResolvers<void>();

	try {
		const ended = exitOnSignalAfter(() => write.promise);

		process.emit('SIGTERM');

		expect(exit).not.toHaveBeenCalled();

		write.resolve();
		await ended;

		expect(exit.mock.calls).toEqual([[signalExitCode('SIGTERM')]]);
	} finally {
		exit.mockRestore();
	}
});

test('a stop after the write ends the process at once, and no stop ends nothing', async () => {
	const exit = exitSpy();

	try {
		await exitOnSignalAfter(async () => {});

		expect(exit).not.toHaveBeenCalled();

		process.emit('SIGTERM');

		expect(exit.mock.calls).toEqual([[signalExitCode('SIGTERM')]]);
	} finally {
		exit.mockRestore();
	}
});
