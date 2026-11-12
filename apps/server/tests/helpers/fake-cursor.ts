import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { fakeBin } from './fake-bin';

/**
 * A fake `cursor-agent` CLI, as a Bun script. `--version`, `status --format json` (`FAKE_CURSOR_SIGNED_IN=1`
 * signs it in) and `models` answer at once. Print mode reads the prompt from stdin, saves a chat under
 * `CURSOR_DATA_DIR/chats/<md5(cwd)>/<session>/` as the CLI does (resuming `--resume <id>`), logs argv, cwd,
 * prompt, the config and data dirs, `cli-config.json`, `mcp.json` (read from the data dir), any `auth.json`
 * in them and the working directory's listing to `FAKE_CURSOR_LOG` (plus its environment to `<log>.env`), then
 * prints `stream-json` for `FAKE_CURSOR_MODE`: an answer (default; `tool` first calls `read_diff` on the MCP
 * server of `mcp.json` and narrates before it), `auth` (stderr, exit 1), `limit` (a failed `result`, exit 1),
 * `garbage` (unparsable output carrying `Authorization: Bearer fake-cursor-token-123`, exit 0), `flood` (more
 * output than the cap), `crash` (stderr, exit 1), `hang` (never answers) or `spawn` (starts a `sleep`
 * grandchild, writes `<own pid> <grandchild pid>` to `<log>.pids` and waits for it).
 */
const SCRIPT = `#!/usr/bin/env bun
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const args = process.argv.slice(2);

if (args.includes('--version')) {
	console.log('2026.11.11-b912975');
	process.exit(0);
}

if (args[0] === 'status' || args[0] === 'whoami') {
	if (process.env.FAKE_CURSOR_SIGNED_IN === '1') {
		console.log('{"authenticated":true,"email":"dev@example.com","plan":"pro"}');
		process.exit(0);
	}
	console.log('{"authenticated":false}');
	process.exit(1);
}

if (args[0] === 'models') {
	console.log(
		[
			'Available models',
			'',
			'auto - Auto (current)',
			'claude-sonnet-4-5 - Claude Sonnet 4.5',
			'gpt-5 - GPT-5',
			'composer-2.5 - Composer 2.5 (default)',
			'',
			'Tip: Use /model inside the CLI to switch models.'
		].join('\\n')
	);
	process.exit(0);
}

const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const say = (value) => console.log(JSON.stringify(value));
const log = process.env.FAKE_CURSOR_LOG;
const prompt = await Bun.stdin.text();
const configDir = process.env.CURSOR_CONFIG_DIR ?? '';
const dataDir = process.env.CURSOR_DATA_DIR ?? '';
const cwd = process.cwd();
const resume = flag('--resume');
const session = resume ?? 'sess-' + createHash('md5').update(configDir).digest('hex').slice(0, 8);
const model = flag('--model') ?? 'auto';

if (dataDir) {
	const workspace = createHash('md5').update(cwd).digest('hex');
	const chat = join(dataDir, 'chats', workspace, session);

	mkdirSync(chat, { recursive: true });
	writeFileSync(join(chat, 'store.db'), 'fake store');
	writeFileSync(join(chat, 'meta.json'), JSON.stringify({ id: session }));
}

if (log) {
	const read = (dir, name) => {
		try {
			return readFileSync(join(dir, name), 'utf8');
		} catch {
			return null;
		}
	};
	let auth = 'none';

	for (const dir of [configDir, dataDir]) {
		try {
			auth = readlinkSync(join(dir, 'auth.json'));
			break;
		} catch {
			if (existsSync(join(dir, 'auth.json'))) {
				auth = 'present';
				break;
			}
		}
	}

	appendFileSync(
		log,
		JSON.stringify({
			args,
			cwd,
			prompt,
			configDir,
			dataDir,
			cliConfig: read(configDir, 'cli-config.json'),
			mcp: read(dataDir, 'mcp.json'),
			auth,
			cwdFiles: readdirSync(cwd)
		}) + '\\n'
	);
	writeFileSync(log + '.env', Object.entries(process.env).map(([k, v]) => k + '=' + v).join('\\n'));
}

const mode = process.env.FAKE_CURSOR_MODE ?? 'answer';
const usage = resume
	? { inputTokens: 1500, outputTokens: 50, cachedInputTokens: 900, cacheWriteTokens: 0 }
	: { inputTokens: 1000, outputTokens: 20, cachedInputTokens: 600, cacheWriteTokens: 0 };

say({
	type: 'system',
	subtype: 'init',
	apiKeySource: 'login',
	cwd,
	session_id: session,
	model,
	permissionMode: 'default'
});

if (mode === 'spawn') {
	const child = Bun.spawn(['sleep', '30']);

	writeFileSync(log + '.pids', process.pid + ' ' + child.pid);
	await child.exited;
	process.exit(0);
}

if (mode === 'hang') {
	await new Promise(() => {});
}

if (mode === 'garbage') {
	console.log('Welcome to cursor-agent!');
	console.log('Debug: Authorization: Bearer fake-cursor-token-123');
	process.exit(0);
}

if (mode === 'crash') {
	console.log('boom: the CLI fell over');
	process.exit(1);
}

if (mode === 'auth') {
	console.log('Error: Authentication required. Run cursor-agent login');
	process.exit(1);
}

if (mode === 'flood') {
	const chunk = 'x'.repeat(1024 * 1024);

	for (let i = 0; i < 40; i++) await new Promise((resolve) => process.stdout.write(chunk, resolve));

	process.exit(0);
}

if (mode === 'limit') {
	say({
		type: 'result',
		subtype: 'error',
		is_error: true,
		result: "You've reached your usage limit. It resets at Nov 1, 2026.",
		session_id: session
	});
	process.exit(1);
}

const results = [];
const first = mode === 'tool' ? 'Reading the diff.' : '';
const assistant = (text, extra) =>
	say({
		type: 'assistant',
		message: { role: 'assistant', model, content: [{ type: 'text', text }] },
		...extra
	});
const finish = (tokens) =>
	say({ type: 'step_finish', model, part: { tokens: { input: tokens.in, output: tokens.out, cache: { read: tokens.cached } } } });

if (first) {
	assistant(first, { timestamp_ms: 1100 });
	assistant(first, { timestamp_ms: 1101, model_call_id: 'call_0' });
	finish(resume ? { in: 500, out: 30, cached: 300 } : { in: 900, out: 15, cached: 500 });
}

if (mode === 'tool' && dataDir && existsSync(join(dataDir, 'mcp.json'))) {
	const config = JSON.parse(readFileSync(join(dataDir, 'mcp.json'), 'utf8'));
	const [server] = Object.values(config.mcpServers);
	const call = { name: 'read_diff', arguments: { path: 'file0.ts' } };

	say({
		type: 'tool_call',
		subtype: 'started',
		call_id: 'call_1',
		tool_call: { name: 'read_diff', args: call.arguments }
	});

	const reply = await fetch(server.url, {
		method: 'POST',
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: call })
	});
	const { result } = await reply.json();

	results.push({ isError: result.isError, text: result.content[0].text });
	say({
		type: 'tool_call',
		subtype: 'completed',
		call_id: 'call_1',
		tool_call: { name: 'read_diff', args: call.arguments },
		result: { content: result.content }
	});
}

const second = mode === 'tool' ? JSON.stringify({ done: true, results }) : 'the reply';
const mid = Math.ceil(second.length / 2);

say({ type: 'thinking', subtype: 'delta', delta: 'Hmm.' });
assistant(second.slice(0, mid), { timestamp_ms: 1200 });
assistant(second.slice(mid), { timestamp_ms: 1201 });
assistant(second, {});
finish(resume ? { in: 500, out: 20, cached: 300 } : { in: 100, out: 5, cached: 100 });

say({
	type: 'result',
	subtype: 'success',
	is_error: false,
	result: first + second,
	session_id: session,
	duration_ms: 12,
	request_id: 'req_1',
	usage
});
`;

/** A fake `cursor-agent` on PATH, with its log files and a user config home holding hooks, an MCP server and a credential. */
export async function fakeCursor(extra: Record<string, string> = {}): Promise<Record<string, string | undefined>> {
	const { env } = await fakeBin('cursor-agent', SCRIPT);
	const dir = await mkdtemp(join(tmpdir(), 'fake-cursor-'));
	const config = join(dir, '.config');

	await Bun.write(
		join(dir, '.cursor', 'hooks.json'),
		JSON.stringify({ hooks: { sessionStart: [{ command: 'touch /tmp/pwned' }] } })
	);

	await Bun.write(join(dir, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { mine: { command: 'my-server' } } }));
	await Bun.write(join(config, 'cursor', 'cli-config.json'), JSON.stringify({ version: 1 }));
	await Bun.write(join(config, 'cursor', 'auth.json'), '{"token":"fake-cursor-user-token"}');

	return {
		...env,
		HOME: dir,
		XDG_CONFIG_HOME: config,
		FAKE_CURSOR_LOG: join(dir, 'log'),
		...extra
	};
}

const callSchema = z.object({
	args: z.array(z.string()),
	cwd: z.string(),
	prompt: z.string(),
	configDir: z.string(),
	dataDir: z.string(),
	cliConfig: z.string().nullable(),
	mcp: z.string().nullable(),
	auth: z.string(),
	cwdFiles: z.array(z.string())
});

/** One call the fake logged: its argv, cwd, the prompt it read and the config files it ran under. */
export type CursorCall = z.infer<typeof callSchema>;

/** The calls the fake logged to `log`, one JSON object per line, in order. */
export async function cursorCalls(log: string): Promise<CursorCall[]> {
	const text = await Bun.file(log).text();

	return text
		.trim()
		.split('\n')
		.filter(Boolean)
		.map((line) => callSchema.parse(JSON.parse(line)));
}

/** The one call the fake logged to `log`; throws when it logged none or several. */
export async function cursorCall(log: string): Promise<CursorCall> {
	const calls = await cursorCalls(log);

	if (calls.length !== 1) throw new Error(`expected one logged call, found ${calls.length}`);

	return calls[0];
}
