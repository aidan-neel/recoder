import { z } from 'zod';
import { fakeBin, loggedCalls } from './fake-bin';

/**
 * A fake `claude` for agent runs, as a Bun script. It appends `{args, cwd, prompt}` for each call to
 * `FAKE_CLAUDE_LOG` (one JSON line per call), saves an empty transcript for `--session-id` under
 * `CLAUDE_CONFIG_DIR` as the CLI does, and prints `stream-json` for `FAKE_CLAUDE_MODE`: an answer (default) in two
 * model messages (thinking, then the text) after calling `read_diff` on the MCP server of `--mcp-config` when it
 * has one; `auth` or `limit` (the CLI's failed-call lines); `garbage` (a line that is not JSON); or `spawn`
 * (starts a `sleep` grandchild, writes `<own pid> <grandchild pid>` to `<log>.pids` and waits for it).
 */
const SCRIPT = `#!/usr/bin/env bun
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);

if (args[0] === '--version') {
	console.log('2.1.321 (Claude Code)');
	process.exit(0);
}

const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const say = (value) => console.log(JSON.stringify(value));
const log = process.env.FAKE_CLAUDE_LOG;
const prompt = await Bun.stdin.text();
const created = flag('--session-id');

if (log) appendFileSync(log, JSON.stringify({ args, cwd: process.cwd(), prompt }) + '\\n');

if (created && process.env.CLAUDE_CONFIG_DIR) {
	const folder = process.env.CLAUDE_CONFIG_DIR + '/projects/' + process.cwd().replace(/[^a-zA-Z0-9]/g, '-');

	mkdirSync(folder, { recursive: true });
	writeFileSync(folder + '/' + created + '.jsonl', '');
}

say({ type: 'system', subtype: 'init', session_id: created ?? flag('--resume'), tools: [], apiKeySource: 'none' });

const mode = process.env.FAKE_CLAUDE_MODE ?? 'answer';

if (mode === 'spawn') {
	const child = Bun.spawn(['sleep', '30']);

	writeFileSync(log + '.pids', process.pid + ' ' + child.pid);
	await child.exited;
}

if (mode === 'garbage') {
	console.log('Welcome to Claude Code!');
	process.exit(0);
}

if (mode === 'auth' || mode === 'limit') {
	const [code, text, status] =
		mode === 'auth'
			? ['authentication_failed', 'Failed to authenticate: OAuth session expired', null]
			: ['rate_limit', "You've hit your limit · resets 3pm (UTC)", 429];

	say({ type: 'assistant', error: code, message: { content: [{ type: 'text', text }] } });
	say({ type: 'result', subtype: 'success', is_error: true, result: text, api_error_status: status });
	process.exit(1);
}

const results = [];
const config = flag('--mcp-config');

if (config) {
	const [server] = Object.values(JSON.parse(config).mcpServers);
	const call = { name: 'read_diff', arguments: { path: 'file0.ts' } };

	const reply = await fetch(server.url, {
		method: 'POST',
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: call })
	});

	const { result } = await reply.json();

	results.push({ isError: result.isError, text: result.content[0].text });
}

const answer = JSON.stringify({ done: true, results });
const event = (value) => say({ type: 'stream_event', event: value });

event({ type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 1 } } });
event({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Hmm.' } });
event({ type: 'message_delta', usage: { output_tokens: 12 } });
event({ type: 'message_stop' });
event({ type: 'message_start', message: { id: 'msg_2', usage: { input_tokens: 200, output_tokens: 1 } } });
event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: answer } });
event({ type: 'message_delta', usage: { output_tokens: 30 } });
event({ type: 'message_stop' });
say({ type: 'result', subtype: 'success', is_error: false, result: answer, usage: { input_tokens: 300, output_tokens: 42 } });
`;

/** The fake on PATH, plus the given `FAKE_CLAUDE_*` settings, as the environment an adapter runs with. */
export async function fakeClaudeAgent(settings: Record<string, string> = {}): Promise<Record<string, string>> {
	const { env } = await fakeBin('claude', SCRIPT);

	return { ...env, ...settings };
}

const callSchema = z.object({ args: z.array(z.string()), cwd: z.string(), prompt: z.string() });

/** What the fake logged for each call, in order. */
export async function fakeClaudeCalls(log: string): Promise<z.infer<typeof callSchema>[]> {
	return z.array(callSchema).parse(await loggedCalls(log));
}
