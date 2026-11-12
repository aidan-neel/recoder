import { expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { streamCli } from '../../src/agents/cli-stream';

/** A CLI that prints part of its reply, starts a child that inherits its stdout, then is killed itself. */
const DIES_LEAVING_A_CHILD = 'echo partial; sleep 30 & kill -9 $$';

test('a CLI killed mid-call ends the call at once, though a child it started still holds its stdout', async () => {
	const output: string[] = [];
	const started = Date.now();

	const exit = await streamCli({
		argv: ['sh', '-c', DIES_LEAVING_A_CHILD],
		cwd: tmpdir(),
		env: { PATH: process.env.PATH ?? '' },
		stdin: null,
		signal: new AbortController().signal,
		maxOutputBytes: 1024,
		onOutput: (piece) => output.push(piece),
		running: new Set(),
		name: 'Fake CLI'
	});

	expect(exit.code).not.toBe(0);
	expect(output.join('')).toBe('partial\n');
	expect(Date.now() - started).toBeLessThan(3_000);
});
