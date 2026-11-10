import { expect, test } from 'bun:test';
import { EXIT } from '../../../src/cli/exit';

const FIXTURE = new URL('./stdout-fixture.ts', import.meta.url).pathname;

function startFixture() {
	return Bun.spawn(['bun', FIXTURE], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
}

test('a report longer than the pipe buffer is written in full before the process decides its exit code', async () => {
	const child = startFixture();
	const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);

	expect(text.length).toBe(5_000_001);
	expect(code).toBe(EXIT.ok);
});

/**
 * The fixture runs in a shell pipeline whose reader ends without reading, so the report can never fit in the pipe and
 * the write must fail. The shell then writes the fixture's exit code as the last line of standard error.
 */
test('a reader that closes the pipe makes the write fail with the failed exit code and no stack trace', async () => {
	const pipeline = Bun.spawn(['sh', '-c', '{ "$0" "$1"; echo "$?" >&2; } | true', process.execPath, FIXTURE], {
		stdout: 'ignore',
		stderr: 'pipe',
		stdin: 'ignore'
	});

	const lines = (await new Response(pipeline.stderr).text()).trimEnd().split('\n');

	expect(lines.at(-1)).toBe(String(EXIT.failed));
	expect(lines.join('\n')).not.toContain(' at ');
});
