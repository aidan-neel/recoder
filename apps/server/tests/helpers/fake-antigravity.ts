import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { fakeBin, loggedCalls } from './fake-bin';

/**
 * A fake `agy` CLI (version 1.5.6) as a Bun script. `--version` prints `1.5.6`, and `--output-format json models`
 * prints the real CLI's JSON catalog when `FAKE_ANTIGRAVITY_SIGNED_IN=1` or exits 1 with the real signed-out stderr
 * message otherwise (`spawn` mode sleeps with a recorded grandchild PID so abort tests can verify cleanup).
 *
 * Headless `stream-json` calls read the NDJSON prompt from stdin, record `{ args, cwd, stdin, prompt, settings,
 * agentMd, conversationId, env }` as one JSON line in `FAKE_ANTIGRAVITY_LOG`, write the three per-conversation paths
 * `agy` creates under `$HOME/.gemini/antigravity-cli`, and act on `FAKE_ANTIGRAVITY_MODE`: `answer` (default two-step
 * reply with reasoning, text and usage), `tool` (calls `read_diff` on the HTTP MCP server in `recoder.md`), `auth`,
 * `limit`, `throttle`, `garbage` (non-JSON line carrying `Authorization: Bearer ...`), `flood` (exceeds stdout cap),
 * `crash`, `empty`, or `spawn` (starts `sleep 30`, writes `<own pid> <child pid>` to `<log>.pids`, and waits).
 */
const SCRIPT = `#!/usr/bin/env bun
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const say = (value) => console.log(JSON.stringify(value));
const log = process.env.FAKE_ANTIGRAVITY_LOG ?? '';
const mode = process.env.FAKE_ANTIGRAVITY_MODE ?? 'answer';

if (args[0] === '--version') {
	console.log('1.5.6');
	process.exit(0);
}

if (args.includes('models')) {
	if (mode === 'spawn') {
		const child = Bun.spawn(['sleep', '30']);

		if (log) writeFileSync(log + '.pids', process.pid + ' ' + child.pid);
		await child.exited;
		process.exit(0);
	}

	if (process.env.FAKE_ANTIGRAVITY_SIGNED_IN !== '1') {
		console.error('Fetching available models...');
		console.error('Error: Please sign in to view available models. Launch the CLI without arguments to sign in.');
		process.exit(1);
	}

	const models = [
		{ id: 'gemini-4-carbon-medium', label: 'Gemini 4 Carbon (Medium)' },
		{ id: 'gemini-4-carbon-high', label: 'Gemini 4 Carbon (High)' },
		{ id: 'gemini-4-carbon-low', label: 'Gemini 4 Carbon (Low)' },
		{ id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
		{ id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
		{ id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
		{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
		{ id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' }
	];

	say({
		conversation_id: '',
		status: 'SUCCESS',
		response: models.map((item) => item.id + '\\t' + item.label + '\\n').join(''),
		duration_seconds: 0,
		num_turns: 0,
		usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 },
		command: { name: 'models', data: { models } }
	});
	process.exit(0);
}

const stdin = await Bun.stdin.text();
let prompt = '';

try {
	const firstLine = stdin.trim().split('\\n')[0] ?? '';

	prompt = JSON.parse(firstLine)?.message?.content ?? '';
} catch {
	prompt = stdin;
}

const settingsPath = flag('--settings');
const settings = settingsPath && existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : null;
const agentPath = join(process.cwd(), '.agents', 'agents', 'recoder.md');
const agentMd = existsSync(agentPath) ? readFileSync(agentPath, 'utf8') : '';
const resumed = flag('--conversation');
const conversationId = resumed ?? crypto.randomUUID();
const home = process.env.HOME ?? '';

if (home) {
	const cliDir = join(home, '.gemini', 'antigravity-cli');

	mkdirSync(join(cliDir, 'conversations'), { recursive: true });
	mkdirSync(join(cliDir, 'annotations'), { recursive: true });
	mkdirSync(join(cliDir, 'brain', conversationId), { recursive: true });
	writeFileSync(join(cliDir, 'conversations', conversationId + '.db'), 'sqlite');
	writeFileSync(join(cliDir, 'annotations', conversationId + '.pbtxt'), 'id: "' + conversationId + '"\\n');
	writeFileSync(join(cliDir, 'brain', conversationId, 'notes.md'), 'scratch');
}

if (log) {
	appendFileSync(
		log,
		JSON.stringify({
			args,
			cwd: process.cwd(),
			stdin,
			prompt,
			settings,
			agentMd,
			conversationId,
			env: process.env
		}) + '\\n'
	);
}

if (mode === 'garbage') {
	console.log('Gateway HTML error: Authorization: Bearer sk-antigravity-secret-token-9999');
	process.exit(0);
}

if (mode === 'flood') {
	const chunk = Buffer.alloc(65_536, 'x');

	chunk[65_535] = 10;
	for (let index = 0; index < 600; index++) await Bun.write(Bun.stdout, chunk);
	process.exit(0);
}

say({
	event: 'init',
	conversation_id: conversationId,
	init: {
		model: flag('--model') ?? '',
		cwd: process.cwd(),
		agent: flag('--agent') ?? '',
		tools: [],
		permission_mode: 'request-review'
	}
});

if (mode === 'spawn') {
	const child = Bun.spawn(['sleep', '30']);

	if (log) writeFileSync(log + '.pids', process.pid + ' ' + child.pid);
	await child.exited;
	process.exit(0);
}

if (mode === 'auth') {
	console.error('Error: Please sign in to continue. Launch the CLI without arguments to sign in.');
	process.exit(1);
}

if (mode === 'limit') {
	const text = 'You have hit your usage limit. Quota resets at 3pm UTC.';

	console.error(
		'AGY_ERROR: ' + JSON.stringify({ status: 'QUOTA_EXHAUSTED', http_status: 429, retryable: false, short_error: text })
	);
	say({ event: 'result', result: { conversation_id: conversationId, status: 'ERROR', error: text } });
	process.exit(3);
}

if (mode === 'throttle') {
	const text = 'Too many requests; rate limit exceeded.';

	console.error('AGY_ERROR: ' + JSON.stringify({ http_status: 429, retryable: true, short_error: text }));
	process.exit(3);
}

if (mode === 'crash') {
	console.error('Error: boom');
	process.exit(1);
}

if (mode === 'empty') {
	say({
		event: 'result',
		result: {
			conversation_id: conversationId,
			status: 'SUCCESS',
			response: '',
			duration_seconds: 0.1,
			num_turns: 1,
			usage: { input_tokens: 10, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 10 }
		}
	});
	process.exit(0);
}

const results = [];

if (mode === 'tool') {
	const urlMatch = /serverUrl:\\s*"([^"]+)"/.exec(agentMd);

	if (urlMatch?.[1]) {
		const call = { name: 'read_diff', arguments: { path: 'file0.ts' } };
		const response = await fetch(urlMatch[1], {
			method: 'POST',
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: call })
		});
		const { result } = await response.json();

		say({
			event: 'step_update',
			step_update: {
				conversation_id: conversationId,
				step_index: 1,
				state: 'DONE',
				step_type: 'tool',
				tool_name: 'mcp_recoder_read_diff'
			}
		});
		results.push({ isError: result.isError, text: result.content[0].text });
	}
}

const answer = mode === 'tool' ? JSON.stringify({ done: true, results }) : 'Hi there';
const firstHalf = mode === 'tool' ? answer : 'Hi ';
const secondHalf = mode === 'tool' ? '' : 'there';

say({
	event: 'step_update',
	step_update: { conversation_id: conversationId, step_index: 0, state: 'DONE', step_type: 'user_input' }
});
say({
	event: 'step_update',
	step_update: {
		conversation_id: conversationId,
		step_index: 1,
		state: 'ACTIVE',
		step_type: 'agent_response',
		thinking_delta: 'Hmm.'
	}
});
say({
	event: 'step_update',
	step_update: {
		conversation_id: conversationId,
		step_index: 1,
		state: 'DONE',
		step_type: 'agent_response',
		usage: { input_tokens: 100, output_tokens: 12, thinking_tokens: 4, cache_read_tokens: 50, total_tokens: 112 }
	}
});
say({
	event: 'step_update',
	step_update: {
		conversation_id: conversationId,
		step_index: 2,
		state: 'ACTIVE',
		step_type: 'agent_response',
		text_delta: firstHalf
	}
});
say({
	event: 'step_update',
	step_update: {
		conversation_id: conversationId,
		step_index: 2,
		state: 'DONE',
		step_type: 'agent_response',
		...(secondHalf ? { text_delta: secondHalf } : {}),
		usage: { input_tokens: 200, output_tokens: 30, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 230 }
	}
});
say({
	event: 'result',
	result: {
		conversation_id: conversationId,
		status: 'SUCCESS',
		response: answer,
		duration_seconds: 0.4,
		num_turns: 1,
		usage: {
			input_tokens: resumed ? 900 : 300,
			output_tokens: resumed ? 84 : 42,
			thinking_tokens: 4,
			cache_read_tokens: 50,
			total_tokens: resumed ? 984 : 342
		}
	}
});
`;

/** Optional personal Antigravity files written under `$HOME/.gemini` to verify runs ignore user customizations. */
interface FakeUserCustomization {
	settings?: Record<string, unknown>;
	hooks?: Record<string, unknown>;
	mcpServers?: Record<string, unknown>;
}

/** A fake `agy` on PATH with an isolated `HOME`, a JSONL call log, and optional user files under `~/.gemini`. */
export async function fakeAntigravity(
	extra: Record<string, string> = {},
	user?: FakeUserCustomization
): Promise<Record<string, string>> {
	const { env } = await fakeBin('agy', SCRIPT);
	const home = extra.HOME ?? (await mkdtemp(join(tmpdir(), 'fake-agy-home-')));
	const log = extra.FAKE_ANTIGRAVITY_LOG ?? join(home, `calls-${crypto.randomUUID()}.jsonl`);

	if (user) {
		const cliDir = join(home, '.gemini', 'antigravity-cli');
		const configDir = join(home, '.gemini', 'config');

		await mkdir(cliDir, { recursive: true });
		await mkdir(configDir, { recursive: true });

		if (user.settings) await writeFile(join(cliDir, 'settings.json'), JSON.stringify(user.settings));
		if (user.hooks) await writeFile(join(configDir, 'hooks.json'), JSON.stringify(user.hooks));

		if (user.mcpServers) {
			await writeFile(join(configDir, 'mcp_config.json'), JSON.stringify({ mcpServers: user.mcpServers }));
		}
	}

	return {
		...env,
		HOME: home,
		FAKE_ANTIGRAVITY_SIGNED_IN: '1',
		FAKE_ANTIGRAVITY_LOG: log,
		...extra
	};
}

const callSchema = z.object({
	args: z.array(z.string()),
	cwd: z.string(),
	stdin: z.string(),
	prompt: z.string(),
	settings: z.record(z.string(), z.unknown()).nullable(),
	agentMd: z.string(),
	conversationId: z.string(),
	env: z.record(z.string(), z.string().optional())
});

/** Every `agy` headless invocation appended to `log`, in order. */
export async function fakeAntigravityCalls(log: string): Promise<z.infer<typeof callSchema>[]> {
	return z.array(callSchema).parse(await loggedCalls(log));
}

/** The three paths under `home` where `agy` stores one conversation's SQLite file, annotation and brain folder. */
export function savedConversationPaths(home: string, conversationId: string): string[] {
	const base = join(home, '.gemini', 'antigravity-cli');

	return [
		join(base, 'conversations', `${conversationId}.db`),
		join(base, 'annotations', `${conversationId}.pbtxt`),
		join(base, 'brain', conversationId)
	];
}
