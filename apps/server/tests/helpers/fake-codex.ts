import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeBin } from './fake-bin';

/** The session id the fake starts, in the shape `thread.started` gives one. */
export const FAKE_CODEX_SESSION = '01a1cf29-482b-7f30-8586-a69e1a8efc15';

/** A fake credential the `garbage` mode prints, which no error may quote. */
export const FAKE_CODEX_CREDENTIAL = 'sk-fake-codex-credential-0123456789';

/**
 * Part of the catalog `codex debug models` printed on 2026-11-12 (codex-cli 0.167.0): two listed models, a hidden
 * one, and a field Recoder does not read. Levels, context windows and sub-agent versions are the real ones.
 */
const CATALOG = {
	models: [
		{
			slug: 'gpt-6-sol',
			display_name: 'GPT-6-Sol',
			visibility: 'list',
			default_reasoning_level: 'medium',
			supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map((effort) => ({
				effort,
				description: `${effort} effort`
			})),
			context_window: 272000,
			multi_agent_version: 'v2',
			base_instructions: 'You are Codex.'
		},
		{
			slug: 'gpt-6-luna',
			display_name: 'GPT-6-Luna',
			visibility: 'list',
			default_reasoning_level: 'medium',
			supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh', 'max'].map((effort) => ({ effort })),
			context_window: 272000,
			multi_agent_version: 'v1'
		},
		{ slug: 'codex-auto-review', display_name: 'Codex Auto Review', visibility: 'hide', context_window: 272000 }
	]
};

/**
 * The lines a usage-capped `codex exec --json` printed on 2026-11-12, word for word, before it exited 1. The
 * success events below follow the `ThreadEvent` types of the CLI's source (`codex-rs/exec/src/exec_events.rs`);
 * no successful run was seen.
 */
const LIMIT_LINES = [
	{ type: 'thread.started', thread_id: FAKE_CODEX_SESSION },
	{ type: 'turn.started' },
	{
		type: 'error',
		message:
			'You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at 5:28 AM.'
	},
	{
		type: 'turn.failed',
		error: {
			message:
				'You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at 5:28 AM.'
		}
	}
];

/**
 * A fake `codex`, as a Bun script. `--version`, `login status` (`FAKE_CODEX_SIGNED_IN=1` signs it in; the status
 * goes to stderr, as the CLI's does) and `debug models` answer at once; `delete --force <id>` appends the id to
 * `<log>.rm`. `exec` (and `exec resume … <id> -`) appends `{args, cwd, files, prompt, system, userConfig, subagents}` to
 * `FAKE_CODEX_LOG` (one JSON line per call; `userConfig` is the user's `config.toml`, read only when
 * `--ignore-user-config` is missing, as the CLI would; `subagents` is the sub-agent version the model's entry names
 * in the catalog the call reads, its `model_catalog_json` or else the CLI's own, which is what offers the model
 * sub-agent tools whatever `--disable` says), writes its environment to `<log>.env`, then acts on
 * `FAKE_CODEX_MODE`: a reply (default: a reasoning summary and an answer, with the session's running usage);
 * `tool` (calls `read_diff` on the MCP server of its `mcp_servers.*.url` override and answers with what it
 * returned); `auth` (a turn that fails with a 401); `limit` (the CLI's usage-cap lines); `garbage` (lines that are
 * not JSON, carrying a bearer credential, and the credential on stderr, exit 1); `flood` (more than the output
 * cap); `crash` (stderr, exit 1); or `spawn` (starts `sleep 30`, writes `<own pid> <child pid>` to `<log>.pids` and
 * waits).
 */
const SCRIPT = `#!/usr/bin/env bun
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const log = process.env.FAKE_CODEX_LOG;
const say = (value) => console.log(JSON.stringify(value));

if (args[0] === '--version') {
	console.log('codex-cli 0.167.0');
	process.exit(0);
}

if (args[0] === 'login' && args[1] === 'status') {
	const signedIn = process.env.FAKE_CODEX_SIGNED_IN === '1';

	console.error(signedIn ? 'Logged in using ChatGPT' : 'Not logged in');
	process.exit(signedIn ? 0 : 1);
}

if (args[0] === 'debug' && args[1] === 'models') {
	console.log(process.env.FAKE_CODEX_CATALOG);
	process.exit(0);
}

if (args[0] === 'delete') {
	appendFileSync(log + '.rm', args.at(-1) + '\\n');
	console.log('Deleted session ' + args.at(-1) + '.');
	process.exit(0);
}

const resumed = args[1] === 'resume';
const overrides = args.flatMap((arg, i) => (args[i - 1] === '-c' ? [arg] : []));
const override = (pattern) => {
	const entry = overrides.find((item) => pattern.test(item.split('=')[0]));

	return entry === undefined ? undefined : JSON.parse(entry.slice(entry.indexOf('=') + 1));
};

const prompt = await Bun.stdin.text();
const system = readFileSync(override(/^model_instructions_file$/), 'utf8');
const userConfig = args.includes('--ignore-user-config') ? null : readFileSync(process.env.CODEX_HOME + '/config.toml', 'utf8');

const files = readdirSync(process.cwd());
const catalogFile = override(/^model_catalog_json$/);
const catalog = JSON.parse(catalogFile === undefined ? process.env.FAKE_CODEX_CATALOG : readFileSync(catalogFile, 'utf8'));
const model = args[args.indexOf('-m') + 1];
const subagents = catalog.models.find((entry) => entry.slug === model)?.multi_agent_version ?? null;

appendFileSync(log, JSON.stringify({ args, cwd: process.cwd(), files, prompt, system, userConfig, subagents }) + '\\n');
writeFileSync(log + '.env', Object.keys(process.env).join('\\n'));

const session = resumed ? args.at(-2) : '${FAKE_CODEX_SESSION}';
const mode = process.env.FAKE_CODEX_MODE ?? 'reply';
const usage = resumed
	? { input_tokens: 1500, cached_input_tokens: 900, cache_write_input_tokens: 0, output_tokens: 50, reasoning_output_tokens: 12 }
	: { input_tokens: 1000, cached_input_tokens: 600, cache_write_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 5 };

const answer = (text) => {
	say({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text } });
	say({ type: 'turn.completed', usage });
};

if (mode === 'limit') {
	for (const line of JSON.parse(process.env.FAKE_CODEX_LIMIT)) say(line);
	process.exit(1);
}

if (mode === 'garbage') {
	console.log('Authorization: Bearer ${FAKE_CODEX_CREDENTIAL}');
	console.error('request failed: Authorization: Bearer ${FAKE_CODEX_CREDENTIAL}');
	process.exit(1);
}

if (mode === 'crash') {
	console.error('boom');
	process.exit(1);
}

if (mode === 'flood') {
	const line = 'x'.repeat(1024 * 1024) + '\\n';

	for (let i = 0; i < 40; i++) await Bun.write(Bun.stdout, line);
	process.exit(0);
}

say({ type: 'thread.started', thread_id: session });
say({ type: 'turn.started' });

if (mode === 'spawn') {
	const child = Bun.spawn(['sleep', '30']);

	writeFileSync(log + '.pids', process.pid + ' ' + child.pid);
	await child.exited;
}

if (mode === 'auth') {
	const message = 'unexpected status 401 Unauthorized: Your authentication token has expired. Please try signing in again.';

	say({ type: 'turn.failed', error: { message } });
	process.exit(1);
}

if (mode === 'tool') {
	const url = override(/^mcp_servers\\.[^.]+\\.url$/);
	const params = { name: 'read_diff', arguments: { path: 'file0.ts' } };
	const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params });
	const { result } = await (await fetch(url, { method: 'POST', body })).json();

	say({ type: 'item.started', item: { id: 'item_0', type: 'mcp_tool_call', server: 'recoder1', tool: 'read_diff', arguments: params.arguments, result: null, error: null, status: 'in_progress' } });
	answer(JSON.stringify({ done: true, results: [{ isError: result.isError, text: result.content[0].text }] }));
	process.exit(0);
}

say({ type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: '**Reading the diff**' } });
answer('the reply');
`;

/**
 * A fake `codex` on PATH with its log, the catalog and limit lines it prints, and a `CODEX_HOME` whose own
 * `config.toml` has a hook and an MCP server, which no call may load.
 */
export async function fakeCodex(extra: Record<string, string> = {}): Promise<Record<string, string>> {
	const { env } = await fakeBin('codex', SCRIPT);
	const dir = await mkdtemp(join(tmpdir(), 'fake-codex-'));
	const home = join(dir, 'home');

	await Bun.write(
		join(home, 'config.toml'),
		'[mcp_servers.mine]\ncommand = "my-server"\n\n[[hooks.SessionStart]]\nhooks = [{ type = "command", command = "touch /tmp/pwned" }]\n'
	);

	return {
		...env,
		HOME: dir,
		CODEX_HOME: home,
		FAKE_CODEX_LOG: join(dir, 'log'),
		FAKE_CODEX_CATALOG: JSON.stringify(CATALOG),
		FAKE_CODEX_LIMIT: JSON.stringify(LIMIT_LINES),
		...extra
	};
}
