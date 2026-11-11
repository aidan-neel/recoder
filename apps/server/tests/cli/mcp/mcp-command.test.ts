import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT } from '../../../src/cli/exit';
import { lineReader } from '../line-reader';
import { childEnvironment } from '../child-env';
import { parseReply, toolCall, toolResultOf, type Reply } from './server-harness';

const FIXTURE = new URL('./mcp-fixture.ts', import.meta.url).pathname;

/** A real background review loads the pipeline before it finds no model configured; the doctor checks the sandbox. */
const TEST_TIMEOUT_MS = 90_000;

/** Long enough for the background review to end on its own, which `recoder_wait` returns at once when it does. */
const WAIT_SECONDS = 60;

const PATCH = ['--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', '-old', '+new', ''].join('\n');

test(
	'standard output holds only JSON-RPC lines through a failed call, a doctor run and a started review',
	async () => {
		const folder = mkdtempSync(join(tmpdir(), 'recoder-mcp-'));
		const diff = join(folder, 'change.patch');

		writeFileSync(diff, PATCH);

		const server = Bun.spawn([process.execPath, FIXTURE], {
			stdin: 'pipe',
			stdout: 'pipe',
			stderr: 'ignore',
			env: childEnvironment(folder)
		});

		const readLine = lineReader(server.stdout);

		const send = async (message: object): Promise<void> => {
			server.stdin.write(`${JSON.stringify(message)}\n`);
			await server.stdin.flush();
		};

		const nextReply = async (): Promise<Reply> => parseReply(await readLine());

		try {
			await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
			await send({ jsonrpc: '2.0', method: 'notifications/initialized' });
			await send(toolCall(2, 'recoder_status', { runId: 'not-a-run' }));
			await send(toolCall(3, 'recoder_doctor', {}));
			await send(toolCall(4, 'recoder_review', { diff, title: 'Change a line' }));

			const replies = [await nextReply(), await nextReply(), await nextReply(), await nextReply()];
			const review = replyWithId(replies, 4);
			const { runId } = JSON.parse(toolResultOf(review).text);

			await send(toolCall(5, 'recoder_wait', { runId, timeoutSeconds: WAIT_SECONDS }));

			const ended = JSON.parse(toolResultOf(await nextReply()).text);

			server.stdin.end();

			expect(await server.exited).toBe(EXIT.ok);
			expect(replies.map((reply) => reply.id).sort()).toEqual([1, 2, 3, 4]);
			expect(toolResultOf(review).isError).toBe(false);
			expect(ended).toMatchObject({ runId, state: 'failed', exitCode: EXIT.notReady });
			await expect(readLine()).rejects.toThrow('got ""');
		} finally {
			server.kill('SIGKILL');
			rmSync(folder, { recursive: true, force: true });
		}
	},
	TEST_TIMEOUT_MS
);

function replyWithId(replies: readonly Reply[], id: number): Reply {
	const reply = replies.find((candidate) => candidate.id === id);

	if (reply === undefined) throw new Error(`no reply to request ${id}`);

	return reply;
}
