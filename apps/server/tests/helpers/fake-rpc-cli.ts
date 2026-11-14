import { fakeBin } from './fake-bin';

/** What the fake answers one method with: a result, or a JSON-RPC error. */
export type FakeRpcReply = { result: unknown } | { error: { code: number; message: string } };

/**
 * A fake JSON-RPC server over stdio, as a Bun script. It prints a notification and a line that is not JSON, then
 * answers each request whose method `FAKE_RPC_REPLIES` names, in the order they come, and exits at the end of its
 * input. With `FAKE_RPC_EXIT=1` it exits at once, answering nothing.
 */
const SCRIPT = `#!/usr/bin/env bun
if (process.env.FAKE_RPC_EXIT === '1') process.exit(0);

const replies = JSON.parse(process.env.FAKE_RPC_REPLIES ?? '{}');
const decoder = new TextDecoder();
let buffer = '';

process.stdout.write('{"method":"configWarning","params":{}}\\nstarting up\\n');

for await (const chunk of Bun.stdin.stream()) {
	buffer += decoder.decode(chunk, { stream: true });

	let end;

	while ((end = buffer.indexOf('\\n')) >= 0) {
		const message = JSON.parse(buffer.slice(0, end));
		const reply = replies[message.method];

		buffer = buffer.slice(end + 1);
		if (message.id !== undefined && reply) process.stdout.write(JSON.stringify({ id: message.id, ...reply }) + '\\n');
	}
}
`;

/** The environment that puts a fake `name` first on PATH, answering each method as `replies` says. */
export async function fakeRpcCli(
	name: string,
	replies: Record<string, FakeRpcReply>,
	extra: Record<string, string> = {}
): Promise<Record<string, string>> {
	const { env } = await fakeBin(name, SCRIPT);

	return { ...env, FAKE_RPC_REPLIES: JSON.stringify(replies), ...extra };
}
