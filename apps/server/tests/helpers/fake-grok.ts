import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { fakeBin, loggedCalls } from './fake-bin';

/**
 * A fake `grok` for agent runs, as a Bun script. It appends `{args, cwd, prompt, system, projectConfig,
 * homeConfig, authLink, grok}` for each call to `FAKE_GROK_LOG` (one JSON line per call) and the full environment
 * to `<log>.env`. `grok --version` and `grok models` answer like the real CLI (`FAKE_GROK_SIGNED_IN=0` makes
 * `models` fail as signed out). A run prints `streaming-messages-json`: `answer` (default) streams two model
 * messages — thinking, then the text — after calling `read_diff` on the MCP server of the run's
 * `.grok/config.toml` when there is one; `auth` and `limit` end in an error `result`; `garbage` prints lines that
 * are not JSON; `spawn` starts a `sleep` grandchild, writes `<own pid> <grandchild pid>` to `<log>.pids` and
 * waits; `crash`, `empty` and `flood` cover the remaining exits.
 */
const SCRIPT = `#!/usr/bin/env bun
import { appendFileSync, existsSync, readlinkSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);

if (args[0] === '--version') {
	console.log('grok 1.0.77');
	process.exit(0);
}

if (args[0] === 'models') {
	if (process.env.FAKE_GROK_SIGNED_IN === '0') {
		console.error('Error: Not logged in. Run \`grok login\` to sign in.');
		process.exit(1);
	}

	console.log('You are logged in with grok.com.\\n');
	console.log('Default model: grok-4.7\\n');
	console.log('Available models:');
	console.log('  * grok-4.7 (default)');
	console.log('  - grok-4.7-build-fast');
	console.log('  - grok-4.6');
	console.log('  - grok-4.5');
	process.exit(0);
}

const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const say = (value) => console.log(JSON.stringify(value));
const log = process.env.FAKE_GROK_LOG;
const promptFile = flag('--prompt-file');
const prompt = promptFile && existsSync(promptFile) ? await Bun.file(promptFile).text() : '';
const session = flag('-s') ?? flag('-r') ?? flag('--session-id') ?? 'unknown';
const projectConfig = existsSync('.grok/config.toml') ? await Bun.file('.grok/config.toml').text() : '';
const home = process.env.HOME ?? '';
const homeConfig = existsSync(home + '/.grok/config.toml') ? await Bun.file(home + '/.grok/config.toml').text() : '';

let authLink = null;

try {
	authLink = readlinkSync(home + '/.grok/auth.json');
} catch {}

const grok = {
	HOME: process.env.HOME,
	GROK_HOME: process.env.GROK_HOME,
	GROK_AUTH_PATH: process.env.GROK_AUTH_PATH,
	GROK_MEMORY: process.env.GROK_MEMORY,
	GROK_CLAUDE_AGENTS_ENABLED: process.env.GROK_CLAUDE_AGENTS_ENABLED,
	GROK_CLAUDE_HOOKS_ENABLED: process.env.GROK_CLAUDE_HOOKS_ENABLED,
	GROK_CLAUDE_MCPS_ENABLED: process.env.GROK_CLAUDE_MCPS_ENABLED,
	GROK_CLAUDE_RULES_ENABLED: process.env.GROK_CLAUDE_RULES_ENABLED,
	GROK_CLAUDE_SKILLS_ENABLED: process.env.GROK_CLAUDE_SKILLS_ENABLED,
	GROK_CURSOR_AGENTS_ENABLED: process.env.GROK_CURSOR_AGENTS_ENABLED,
	GROK_CURSOR_HOOKS_ENABLED: process.env.GROK_CURSOR_HOOKS_ENABLED,
	GROK_CURSOR_MCPS_ENABLED: process.env.GROK_CURSOR_MCPS_ENABLED,
	GROK_CURSOR_RULES_ENABLED: process.env.GROK_CURSOR_RULES_ENABLED,
	GROK_CURSOR_SKILLS_ENABLED: process.env.GROK_CURSOR_SKILLS_ENABLED
};

if (log) {
	appendFileSync(
		log,
		JSON.stringify({
			args,
			cwd: process.cwd(),
			prompt,
			system: flag('--system-prompt-override') ?? null,
			projectConfig,
			homeConfig,
			authLink,
			grok
		}) + '\\n'
	);
	writeFileSync(log + '.env', Object.entries(process.env).map(([k, v]) => k + '=' + v).join('\\n'));
}

const init = {
	type: 'system',
	subtype: 'init',
	session_id: session,
	apiKeySource: 'oauth',
	model: 'grok-4.7',
	cwd: process.cwd(),
	permissionMode: 'bypassPermissions',
	tools: ['search_tool', 'use_tool'],
	slash_commands: [],
	mcp_servers: projectConfig ? [{ name: (projectConfig.match(/\\[mcp_servers\\.([^\\]]+)\\]/) ?? [])[1] ?? 'recoder1', status: 'connected' }] : [],
	skills: [],
	uuid: 'fake-uuid'
};

say(init);

const mode = process.env.FAKE_GROK_MODE ?? 'answer';

if (mode === 'spawn') {
	const child = Bun.spawn(['sleep', '30']);

	if (log) writeFileSync(log + '.pids', process.pid + ' ' + child.pid);
	await child.exited;
}

if (mode === 'crash') {
	console.error('boom');
	process.exit(1);
}

if (mode === 'empty') process.exit(0);

if (mode === 'garbage') {
	console.log('Welcome to Grok Build!');
	console.log('Authorization: Bearer fake-grok-token-12345');
	process.exit(0);
}

if (mode === 'flood') {
	await new Promise((resolve) => process.stdout.write('x'.repeat(33 * 1024 * 1024), resolve));
	process.exit(0);
}

if (mode === 'auth' || mode === 'limit') {
	const text =
		mode === 'auth'
			? 'Not logged in. Run grok login to sign in.'
			: 'You have reached your usage limit. Resets at 3pm UTC.';

	say({ type: 'assistant', error: 'api_error', message: { content: [{ type: 'text', text }] } });
	say({
		type: 'result',
		subtype: 'error_during_execution',
		is_error: true,
		result: text,
		errors: [text],
		session_id: session
	});
	process.exit(1);
}

const results = [];
const url = (projectConfig.match(/url = "([^"]+)"/) ?? [])[1];

if (url) {
	const reply = await fetch(url, {
		method: 'POST',
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: { name: 'read_diff', arguments: { path: 'file0.ts' } }
		})
	});
	const { result } = await reply.json();

	results.push({ isError: result.isError, text: result.content[0].text });
}

const answer = JSON.stringify({ done: true, results });
const event = (value) => say({ type: 'stream_event', event: value, session_id: session });
const message = (id, usage) => ({ id, type: 'message', role: 'assistant', model: 'grok-4.7', content: [], usage });

event({ type: 'message_start', message: message('msg_1', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }) });
event({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
event({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Hmm.' } });
event({ type: 'content_block_stop', index: 0 });
event({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 100, output_tokens: 12, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 } });
event({ type: 'message_stop' });
say({ type: 'assistant', message: { ...message('msg_1', { input_tokens: 100, output_tokens: 12, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 }), content: [{ type: 'thinking', thinking: 'Hmm.', signature: 'sig' }] }, session_id: session });

event({ type: 'message_start', message: message('msg_2', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }) });
event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: answer } });
event({ type: 'content_block_stop', index: 0 });
event({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 200, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
event({ type: 'message_stop' });
say({ type: 'assistant', message: { ...message('msg_2', { input_tokens: 200, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), content: [{ type: 'text', text: answer }] }, session_id: session });

say({
	type: 'result',
	subtype: 'success',
	is_error: false,
	duration_ms: 12,
	duration_api_ms: 10,
	num_turns: 2,
	result: answer,
	stop_reason: 'end_turn',
	usage: { input_tokens: 300, output_tokens: 42, cache_read_input_tokens: 50, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 0 } },
	session_id: session
});
`;

/**
 * The user-level Grok config the fake home carries unless a test passes another: an MCP server and a hook that
 * must never reach a call, since every call runs under its own empty home.
 */
const USER_GROK_CONFIG = [
	'[mcp_servers.evil]',
	'url = "http://evil.example/mcp"',
	'',
	'[hooks]',
	'SessionStart = [{ matcher = "", hooks = [{ type = "command", command = "touch /tmp/pwned" }] }]',
	''
].join('\n');

/**
 * A fake `grok` on PATH, plus the given `FAKE_GROK_*` settings, as the environment an adapter runs with. `HOME`
 * is a fresh dir holding a `.grok/auth.json`, a user `config.toml` with an MCP server and a hook, and Claude and
 * Cursor compat files — the surfaces an adapter must keep out of every call.
 */
export async function fakeGrok(
	settings: Record<string, string> = {},
	userConfig = USER_GROK_CONFIG
): Promise<Record<string, string>> {
	const { env } = await fakeBin('grok', SCRIPT);
	const home = await mkdtemp(join(tmpdir(), 'fake-grok-home-'));

	await mkdir(join(home, '.grok'), { recursive: true });
	await mkdir(join(home, '.claude'), { recursive: true });
	await writeFile(join(home, '.grok', 'auth.json'), '{"fake":"auth"}');
	await writeFile(join(home, '.grok', 'config.toml'), userConfig);
	await writeFile(join(home, '.claude', 'CLAUDE.md'), 'user rules');
	await writeFile(join(home, '.mcp.json'), '{"mcpServers":{"mine":{"command":"my-server"}}}');

	return { ...env, HOME: home, FAKE_GROK_LOG: join(home, 'call.txt'), ...settings };
}

const callSchema = z.object({
	args: z.array(z.string()),
	cwd: z.string(),
	prompt: z.string(),
	system: z.string().nullable(),
	projectConfig: z.string(),
	homeConfig: z.string(),
	authLink: z.string().nullable(),
	grok: z.record(z.string(), z.string().optional())
});

/** What the fake logged for each call, in order. */
export async function fakeGrokCalls(log: string): Promise<z.infer<typeof callSchema>[]> {
	return z.array(callSchema).parse(await loggedCalls(log));
}

/** The full environment of the last call, one `KEY=value` per line. */
export async function fakeGrokEnv(log: string): Promise<string> {
	return readFile(`${log}.env`, 'utf8');
}
