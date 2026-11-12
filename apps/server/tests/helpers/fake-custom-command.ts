import { join } from 'node:path';
import { z } from 'zod';
import { fakeBin, loggedCalls } from './fake-bin';

/**
 * A fake custom command, as a Bun script named `my-agent`, that speaks the custom-command protocol. It appends
 * `{argv, request}` for each call to `FAKE_AGENT_LOG` (one JSON line per call) and its environment to
 * `<log>.env`. `describe` lists two models. A turn acts on `FAKE_AGENT_MODE`: an answer (default) in one step
 * after calling `read_diff` over the request's MCP server when it has one; `auth` or `limit` (an `error` event);
 * `notjson`, `version2` or `invalid` (a bad line); `leak` (an authorization header in place of an event); `after` (an event after the result); `noresult` (exit 0
 * without one); `crash` (stderr, exit 3); `flood` (a megabyte of text); or `spawn` (starts a `sleep`
 * grandchild, writes `<own pid> <grandchild pid>` to `<log>.pids` and waits for it).
 */
const SCRIPT = `#!/usr/bin/env bun
import { appendFileSync, writeFileSync } from 'node:fs';

const request = JSON.parse(await Bun.stdin.text());
const log = process.env.FAKE_AGENT_LOG;
const mode = process.env.FAKE_AGENT_MODE ?? 'answer';
const header = { protocol: 'recoder.agent', version: 1 };
const say = (event) => console.log(JSON.stringify({ ...header, ...event }));

if (log) {
	appendFileSync(log, JSON.stringify({ argv: process.argv.slice(2), request }) + '\\n');
	writeFileSync(log + '.env', JSON.stringify(process.env));
}

if (request.kind === 'describe') {
	say({
		type: 'describe',
		name: 'My agent',
		agentVersion: '0.4.1',
		models: [
			{ id: 'fast', label: 'Fast', contextWindow: 128000 },
			{ id: 'deep', label: 'Deep', efforts: ['low', 'high'], defaultEffort: 'high' }
		]
	});
	process.exit(0);
}

if (mode === 'spawn') {
	const child = Bun.spawn(['sleep', '30']);

	writeFileSync(log + '.pids', process.pid + ' ' + child.pid);
	await child.exited;
}

if (mode === 'auth') say({ type: 'error', kind: 'auth', message: 'run my-agent login' });
if (mode === 'limit') say({ type: 'error', kind: 'usage_limit', message: 'plan spent until 3pm' });
if (mode === 'notjson') console.log('hello there');
if (mode === 'leak') console.log('Authorization: Bearer sk-fake-credential-1234');
if (mode === 'version2') console.log(JSON.stringify({ ...header, version: 2, type: 'text', text: 'hi' }));
if (mode === 'invalid') say({ type: 'text' });
if (mode === 'flood') for (let i = 0; i < 1024; i++) say({ type: 'text', text: 'x'.repeat(1024) });

if (mode === 'crash') {
	console.error('boom: the model server is down');
	process.exit(3);
}

if (mode !== 'answer' && mode !== 'after') process.exit(0);

const results = [];

if (request.mcp) {
	const params = { name: 'read_diff', arguments: { path: 'file0.ts' } };
	const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params });
	const { result } = await (await fetch(request.mcp.url, { method: 'POST', body })).json();

	results.push({ isError: result.isError, text: result.content[0].text });
}

const answer = JSON.stringify({ done: true, results });

say({ type: 'step', id: 'call-1' });
say({ type: 'reasoning', text: 'Thinking.' });
say({ type: 'text', text: answer });
say({ type: 'usage', id: 'call-1', inputTokens: 40, outputTokens: 8 });
say({ type: 'result', text: answer, session: 'session-' + request.messages.length });

if (mode === 'after') say({ type: 'text', text: 'late' });
`;

/** The fake on PATH and an environment that configures it as the custom command, with `settings` added. */
export async function fakeCustomCommand(
	settings: Record<string, string> = {},
	config: Record<string, unknown> = {}
): Promise<Record<string, string>> {
	const { env } = await fakeBin('my-agent', SCRIPT);
	const log = join(env.PATH.split(':')[0], 'calls.jsonl');

	return {
		...env,
		FAKE_AGENT_LOG: log,
		RECODER_CUSTOM_AGENT: JSON.stringify({ argv: ['my-agent', '--protocol'], name: 'My agent', ...config }),
		...settings
	};
}

const callSchema = z.object({ argv: z.array(z.string()), request: z.unknown() });

/** What the fake logged for each call, in order: its arguments and the request it read. */
export async function fakeCustomCalls(log: string): Promise<z.infer<typeof callSchema>[]> {
	return z.array(callSchema).parse(await loggedCalls(log));
}
