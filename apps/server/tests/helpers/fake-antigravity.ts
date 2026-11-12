import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { SUMMARIES_SCHEMA_SQL } from './fake-antigravity-history';
import { fakeBin, loggedCalls } from './fake-bin';

export {
	hasProtoSummary,
	savedConversationPaths,
	seedConversationSummary,
	summaryRowCount
} from './fake-antigravity-history';

/**
 * A fake `agy` CLI (version 1.5.6) as a Bun script. `--version` prints `1.5.6`, and `--output-format json models`
 * prints the real CLI's JSON catalog when `FAKE_ANTIGRAVITY_SIGNED_IN=1` or exits 1 with the real signed-out stderr
 * message otherwise (`spawn` mode sleeps with a recorded grandchild PID so abort tests can verify cleanup).
 *
 * Headless `stream-json` calls read the NDJSON prompt from stdin, record `{ args, cwd, stdin, prompt, settings,
 * agentMd, conversationId, env }` as one JSON line in `FAKE_ANTIGRAVITY_LOG`, write the per-conversation files, lock
 * and `conversation_summaries.db` rows `agy` creates under `$HOME/.gemini/antigravity-cli`, and act on
 * `FAKE_ANTIGRAVITY_MODE`: `answer` (default two-step reply with reasoning, text and usage), `tool` (calls `read_diff`
 * on the HTTP MCP server in `recoder.md`), `auth`, `limit`, `throttle`, `garbage`, `flood`, `crash`, `empty`,
 * `streamed-only`, or `spawn` (prints `init`, starts `sleep 30`, writes `<own pid> <child pid>` to `<log>.pids`, and
 * waits).
 *
 * The first call in a home creates the summaries database as a private file and links it into place. Two fakes
 * that start together in one home would otherwise both switch the new file to WAL, and SQLite refuses the second
 * switch at once ("database is locked") instead of waiting for the first.
 */
const SCRIPT = `#!/usr/bin/env bun
import { Database } from 'bun:sqlite';
import { appendFileSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA_SQL = ${JSON.stringify(SUMMARIES_SCHEMA_SQL)};
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

function createSummaries(path) {
	if (existsSync(path)) return;

	const draft = path + '.' + process.pid;
	const db = new Database(draft);

	try {
		db.run('PRAGMA journal_mode = WAL');
		db.exec(SCHEMA_SQL);
	} finally {
		db.close();
	}

	try {
		linkSync(draft, path);
	} catch (error) {
		if (error.code !== 'EEXIST') throw error;
	} finally {
		rmSync(draft);
	}
}

const stdin = await Bun.stdin.text();
let prompt = '';

try {
	prompt = JSON.parse(stdin.trim().split('\\n')[0] ?? '')?.message?.content ?? '';
} catch {
	prompt = stdin;
}

const settingsPath = flag('--settings');
const settings = settingsPath && existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : null;
const agentPath = join(process.cwd(), '.agents', 'agents', 'recoder.md');
const agentMd = existsSync(agentPath) ? readFileSync(agentPath, 'utf8') : '';
const resumed = flag('--conversation');
const conversationId = resumed ?? process.env.FAKE_ANTIGRAVITY_CONVERSATION_ID ?? crypto.randomUUID();
const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId);
const home = process.env.HOME ?? '';

if (home && validUuid) {
	const cliDir = join(home, '.gemini', 'antigravity-cli');
	const now = new Date().toISOString();

	for (const sub of ['conversations', 'annotations', 'presence', join('brain', conversationId)]) {
		mkdirSync(join(cliDir, sub), { recursive: true });
	}
	writeFileSync(join(cliDir, 'conversations', conversationId + '.db'), 'sqlite');
	writeFileSync(join(cliDir, 'annotations', conversationId + '.pbtxt'), 'id: "' + conversationId + '"\\n');
	writeFileSync(join(cliDir, 'presence', conversationId + '.lock'), '');
	writeFileSync(join(cliDir, 'brain', conversationId, 'notes.md'), 'scratch');

	if (!resumed) {
		const varint = (n) => {
			const out = [];
			let v = n;
			while (v >= 0x80) {
				out.push((v & 0x7f) | 0x80);
				v >>>= 7;
			}
			out.push(v);
			return Buffer.from(out);
		};
		const bytesField = (no, buf) => Buffer.concat([varint((no << 3) | 2), varint(buf.length), buf]);
		const protoEntry = bytesField(
			1,
			Buffer.concat([
				bytesField(1, Buffer.from(conversationId, 'utf8')),
				bytesField(2, bytesField(1, Buffer.from(prompt, 'utf8')))
			])
		);
		const summaries = join(cliDir, 'conversation_summaries.db');

		createSummaries(summaries);

		const db = new Database(summaries);

		try {
			db.run('PRAGMA busy_timeout = 5000');
			db.transaction(() => {
				db.query(
					'INSERT OR REPLACE INTO conversation_summaries (conversation_id, preview, step_count, last_modified_time, workspace_uris, agent_name, last_user_input_time) VALUES (?, ?, ?, ?, ?, ?, ?)'
				).run(conversationId, prompt, 2, now, JSON.stringify(['file://' + process.cwd()]), flag('--agent') ?? '', now);
				db.query(
					'INSERT INTO conversations_fts (conversation_id, title, workspace, project, user_body, agent_body) VALUES (?, ?, ?, ?, ?, ?)'
				).run(conversationId, '', 'antigravity-empty', '', prompt, '');
				db.query('INSERT OR REPLACE INTO conversation_parents (conversation_id, parent_id) VALUES (?, ?)').run(
					conversationId,
					''
				);
				appendFileSync(join(cliDir, 'jetbox_summaries_proto.pb'), protoEntry);
			}).immediate();
		} finally {
			db.close();
		}
	}
}

if (log) {
	appendFileSync(
		log,
		JSON.stringify({ args, cwd: process.cwd(), stdin, prompt, settings, agentMd, conversationId, env: process.env }) +
			'\\n'
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
	say({
		event: 'step_update',
		step_update: { conversation_id: conversationId, step_index: 1, state: 'ACTIVE', step_type: 'agent_response', thinking_delta: 'Hmm.' }
	});

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

	console.error('AGY_ERROR: ' + JSON.stringify({ status: 'QUOTA_EXHAUSTED', http_status: 429, retryable: false, short_error: text }));
	say({ event: 'result', result: { conversation_id: conversationId, status: 'ERROR', error: text } });
	process.exit(3);
}

if (mode === 'throttle') {
	console.error('AGY_ERROR: ' + JSON.stringify({ http_status: 429, retryable: true, short_error: 'Too many requests; rate limit exceeded.' }));
	process.exit(3);
}

if (mode === 'crash') {
	console.error('Error: boom');
	process.exit(1);
}

if (mode === 'empty' || mode === 'streamed-only') {
	if (mode === 'streamed-only') {
		say({
			event: 'step_update',
			step_update: {
				conversation_id: conversationId,
				step_index: 1,
				state: 'DONE',
				step_type: 'agent_response',
				text_delta: 'Streamed reply',
				usage: { input_tokens: 10, output_tokens: 3, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 13 }
			}
		});
	}

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
			step_update: { conversation_id: conversationId, step_index: 1, state: 'DONE', step_type: 'tool', tool_name: 'mcp_recoder_read_diff' }
		});
		results.push({ isError: result.isError, text: result.content[0].text });
	}
}

const answer = mode === 'tool' ? JSON.stringify({ done: true, results }) : 'Hi there';
const firstHalf = mode === 'tool' ? answer : 'Hi ';
const secondHalf = mode === 'tool' ? '' : 'there';

say({ event: 'step_update', step_update: { conversation_id: conversationId, step_index: 0, state: 'DONE', step_type: 'user_input' } });
say({ event: 'step_update', step_update: { conversation_id: conversationId, step_index: 1, state: 'ACTIVE', step_type: 'agent_response', thinking_delta: 'Hmm.' } });
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
say({ event: 'step_update', step_update: { conversation_id: conversationId, step_index: 2, state: 'ACTIVE', step_type: 'agent_response', text_delta: firstHalf } });
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
