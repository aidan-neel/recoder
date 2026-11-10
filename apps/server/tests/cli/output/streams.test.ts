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

test('a reader that closes the pipe makes the write fail with the failed exit code and no stack trace', async () => {
	const child = startFixture();
	const reader = child.stdout.getReader();

	await reader.read();
	await reader.cancel();

	expect(await child.exited).toBe(EXIT.failed);
	expect(await new Response(child.stderr).text()).not.toContain(' at ');
});
