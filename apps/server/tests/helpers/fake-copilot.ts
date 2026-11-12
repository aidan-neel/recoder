import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmError, UsageLimitError } from '../../src/models/llm/errors';
import { fakeBin } from './fake-bin';
import type { CallFailure } from './native-agent';

/**
 * What the `tool` mode runs inside the fake: one MCP `tools/call` to the server Recoder put in
 * `--additional-mcp-config`, answered as the final assistant message. The events around it are printed by the
 * script itself, in the shapes the real CLI's `--output-format json` emits.
 */
const TOOL_CALL = `
	const raw = flag('--additional-mcp-config');
	const [server] = Object.values(JSON.parse(raw).mcpServers);
	const params = { name: 'read_diff', arguments: { path: 'file0.ts' } };
	const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params });
	const { result } = await (await fetch(server.url, { method: 'POST', body })).json();
	const text = result.content[0].text;
	say({ type: 'tool.execution_complete', data: {
		toolCallId: 'call_1', model, interactionId, turnId: '0', rte: false, success: true,
		result: { content: text, detailedContent: text, contents: [{ type: 'text', text }] },
		toolTelemetry: { metrics: { mcp_result_content_bytes: text.length } }
	}});
`;

/**
 * A fake `copilot` CLI printing what `copilot --output-format json` really prints (v1.0.109, run against a mock
 * provider): `session.start`/`session.resume`, `session.mcp_servers_loaded`, `session.tools_updated`,
 * `user.message`, `assistant.turn_start`, `model.call_start`, `assistant.reasoning_delta`,
 * `assistant.message_start`, `assistant.message_delta`, `assistant.tool_call_delta`, `assistant.message`,
 * `tool.execution_start`/`tool.execution_complete`, `model.call_finished`, `model.call_final_result`,
 * `assistant.turn_end`, `assistant.idle`, `session.error` and a top-level `result`. `--version` answers at once.
 * Prompt mode reads the prompt from stdin, writes its arguments, working directory, prompt, `COPILOT_HOME`,
 * the settings file in it (or `missing`) and its environment to `FAKE_COPILOT_LOG`, saves a
 * `session-state/<id>/events.jsonl` for `--session-id` under that `COPILOT_HOME`, and writes the
 * `--usage-output-file` JSON in the real cumulative `modelMetrics` shape (its totals grow with each prompt of
 * the session). `FAKE_COPILOT_MODE`: a reply (default), `tool` (calls `read_diff` on the MCP server of
 * `--additional-mcp-config`, then answers), `auth` (the real signed-out stderr and exit 1), `limit` (a
 * `session.error` usage cap and exit 1), `crash` (stderr, exit 1), `garbage` (two lines that are not JSONL,
 * one carrying a fake credential, exit 0), `flood` (more output than the cap) or `spawn` (starts a `sleep`
 * grandchild, writes `<own pid> <grandchild pid>` to `<log>.pids`, waits).
 */
const SCRIPT = `#!/usr/bin/env bun
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);

if (args[0] === '--version') {
	console.log('GitHub Copilot CLI 1.0.109.');
	console.log("Run 'copilot update' to check for updates.");
	process.exit(0);
}

const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const log = process.env.FAKE_COPILOT_LOG;
const prompt = await Bun.stdin.text();
const session = flag('--session-id');
const model = flag('--model') ?? 'auto';
const home = process.env.COPILOT_HOME;
const settings = home && existsSync(home + '/settings.json') ? readFileSync(home + '/settings.json', 'utf8') : 'missing';
let eventsPath = null;
let priorEvents = 0;

if (session && home) {
	const folder = home + '/session-state/' + session;

	mkdirSync(folder, { recursive: true });
	eventsPath = folder + '/events.jsonl';
	if (!existsSync(eventsPath)) writeFileSync(eventsPath, '');
	else priorEvents = readFileSync(eventsPath, 'utf8').split('\\n').filter(Boolean).length;
}

if (log) {
	appendFileSync(log, JSON.stringify({ args, cwd: process.cwd(), prompt, home, settings }) + '\\n');
	writeFileSync(log + '.env', JSON.stringify(process.env));
}

const usage = flag('--usage-output-file');
let calls = 1;

if (usage && home) {
	const callsFile = home + '/.fake-calls';

	try {
		calls = JSON.parse(readFileSync(callsFile, 'utf8')).calls + 1;
	} catch {}
	writeFileSync(callsFile, JSON.stringify({ calls }));
}

const base = { inputTokens: 1000, outputTokens: 20, cacheReadTokens: 600, cacheWriteTokens: 5 };
const grown = { inputTokens: 500, outputTokens: 10, cacheReadTokens: 300, cacheWriteTokens: 3 };
const totals = Object.fromEntries(
	Object.entries(base).map(([key, value]) => [key, value + grown[key] * (calls - 1)])
);

if (usage) {
	const metric = {
		requests: { count: calls, cost: 0 },
		usage: totals,
		totalNanoAiu: 0,
		aiCreditsStatus: 'unavailable'
	};

	writeFileSync(
		usage,
		JSON.stringify({
			totalPremiumRequestCost: 0,
			totalUserRequests: calls,
			totalNanoAiu: 42,
			aiCreditsStatus: 'unavailable',
			totalApiDurationMs: calls * 4,
			sessionStartTime: new Date().toISOString(),
			codeChanges: { linesAdded: 0, linesRemoved: 0, filesModifiedCount: 0, filesModified: [] },
			modelMetrics: { [model]: metric },
			agentMetrics: { main: { totalApiDurationMs: calls * 4, totalNanoAiu: 0, modelMetrics: { [model]: metric } } },
			providerModelMetrics: [
				{ provider: null, modelId: model, metrics: metric, modelDisplayName: model }
			],
			currentModel: model,
			lastCallInputTokens: calls === 1 ? base.inputTokens : grown.inputTokens,
			lastCallOutputTokens: calls === 1 ? base.outputTokens : grown.outputTokens
		})
	);
}

const mode = process.env.FAKE_COPILOT_MODE ?? 'reply';
const started = Date.now();
let lastId = null;
const interactionId = randomUUID();
const originatingId = randomUUID();

const say = (type, data, ephemeral = false) => {
	const event = { type, id: randomUUID(), timestamp: new Date().toISOString(), parentId: lastId };

	if (data !== undefined) event.data = data;
	if (ephemeral) event.ephemeral = true;
	lastId = event.id;

	const line = JSON.stringify(event);

	console.log(line);
	if (eventsPath) appendFileSync(eventsPath, line + '\\n');
};

const callFinished = (turn) =>
	say(
		'model.call_finished',
		{
			turnId: String(turn),
			dispatchDurationMs: 1,
			outcome: 'success',
			editClassifierVersion: 1,
			interactionId,
			containsBuiltInFileEditRequest: false
		},
		true
	);

const finish = (code) => {
	say('assistant.idle', {}, true);
	console.log(
		JSON.stringify({
			type: 'result',
			timestamp: new Date().toISOString(),
			sessionId: session,
			exitCode: code,
			usage: {
				premiumRequests: 0,
				totalApiDurationMs: Date.now() - started,
				sessionDurationMs: Date.now() - started,
				codeChanges: { linesAdded: 0, linesRemoved: 0, filesModified: [] }
			}
		})
	);
};

const sessionContext = { cwd: process.cwd() };

if (mode === 'auth') {
	console.error('Error: No authentication information found.');
	console.error('');
	console.error('Copilot can be authenticated with GitHub using an OAuth Token or a Fine-Grained Personal Access Token.');
	console.error("Run 'gh auth login' to authenticate with the GitHub CLI");
	process.exit(1);
}

if (mode === 'crash') {
	console.error('copilot: internal error: boom');
	process.exit(1);
}

if (mode === 'garbage') {
	console.log('Welcome to GitHub Copilot CLI!');
	console.log('Authorization: Bearer fake-copilot-credential');
	process.exit(0);
}

if (mode === 'flood') {
	const chunk = 'x'.repeat(256 * 1024);

	for (let i = 0; i < 160; i++) writeSync(1, chunk);
	process.exit(0);
}

if (priorEvents > 0) {
	say('session.resume', {
		resumeTime: new Date().toISOString(),
		eventCount: priorEvents,
		eventsFileSizeBytes: statSync(eventsPath).size,
		selectedModel: model,
		contextTier: null,
		sessionLimits: null,
		context: sessionContext,
		alreadyInUse: false,
		remoteSteerable: false,
		sessionWasActive: false
	});
} else {
	say('session.start', {
		sessionId: session,
		version: 1,
		producer: 'copilot-agent',
		copilotVersion: '1.0.109',
		startTime: new Date().toISOString(),
		selectedModel: model,
		contextTier: null,
		context: sessionContext,
		alreadyInUse: false,
		remoteSteerable: false
	});
}

say('session.skills_loaded', { skills: [] });

const mcpConfig = flag('--additional-mcp-config');
const mcpServers = mcpConfig ? Object.keys(JSON.parse(mcpConfig).mcpServers) : [];

say(
	'session.mcp_servers_loaded',
	{
		servers: [
			{ name: 'WorkIQ', status: 'disabled' },
			{ name: 'browser-use', status: 'disabled' },
			{ name: 'github-copilot-browser', status: 'disabled' },
			{ name: 'github-mcp-server', status: 'disabled' },
			...mcpServers.map((name) => ({ name, status: 'connected', serverMetadata: { instructions: null } }))
		]
	},
	true
);

for (const name of mcpServers) {
	say('session.mcp_server_status_changed', { serverName: name, status: 'pending' }, true);
	say('session.mcp_server_status_changed', { serverName: name, status: 'connected', configSource: 'user' }, true);
	say('session.mcp_server_tools_loaded', { serverName: name, toolCount: 2 }, true);
}

say('session.tools_updated', { model }, true);

say('user.message', {
	content: prompt,
	transformedContent: '<current_datetime>' + new Date().toISOString() + '</current_datetime>\\n\\n' + prompt,
	messageId: originatingId,
	delivery: 'idle',
	interactionId,
	turnId: '0',
	parentAgentTaskId: randomUUID()
});
say('assistant.turn_start', { turnId: '0', interactionId, agentMode: 'interactive' });

if (mode === 'spawn') {
	say('model.call_start', { turnId: '0', model }, true);

	const child = Bun.spawn(['sleep', '30']);

	writeFileSync(log + '.pids', process.pid + ' ' + child.pid);
	await child.exited;
	process.exit(0);
}

if (mode === 'limit') {
	say('model.call_start', { turnId: '0', model }, true);
	say(
		'model.call_failure',
		{
			model,
			statusCode: 429,
			durationMs: 1,
			apiEndpoint: '/chat/completions',
			transport: 'http',
			inferenceGateway: false,
			requestBodyBytes: 100,
			requestBodyWireBytes: 100,
			requestBodyEncoding: 'identity',
			retryAttempt: 5,
			failureKind: 'api',
			maxPromptTokens: 128000,
			isByok: true,
			byokKind: 'local_user',
			modelProvider: 'other',
			providerType: 'openai',
			isAuto: false,
			interactionType: 'conversation-agent',
			rte: false,
			source: 'top_level',
			errorMessage: '{"message":"quota exceeded","type":"quota"}',
			errorType: 'quota'
		},
		true
	);
	say('model.call_final_result', { model, isByok: true, result: 'http_429' }, true);
	say('assistant.turn_end', { turnId: '0' });
	say('session.error', {
		errorType: 'quota',
		message: "You've reached your usage limit for this billing cycle. Your limit resets at 3pm (UTC).",
		statusCode: 429,
		providerErrorType: 'quota',
		originatingMessageId: originatingId
	});
	finish(1);
	process.exit(1);
}

const callTurn = (turn, messageId, requests) => {
	say('model.call_start', { turnId: String(turn), model }, true);
	say('assistant.tool_call_delta', {
		toolCallId: 'call_1',
		toolName: requests[0].name,
		toolType: 'function',
		inputDelta: JSON.stringify(requests[0].arguments)
	}, true);
	callFinished(turn);
	say('assistant.message', {
		messageId,
		originatingMessageId: originatingId,
		model,
		content: '',
		toolRequests: requests.map((request) => ({
			toolCallId: 'call_1',
			name: request.name,
			arguments: request.arguments,
			type: 'function',
			intentionSummary: 'file0.ts',
			toolTitle: 'read_diff',
			mcpServerName: mcpServers[0],
			mcpToolName: 'read_diff'
		})),
		interactionId,
		turnId: String(turn),
		rte: false,
		apiCallId: 'chatcmpl-1'
	});
	say('tool.execution_start', {
		toolCallId: 'call_1',
		toolName: requests[0].name,
		arguments: requests[0].arguments,
		turnId: String(turn),
		model,
		toolTitle: 'read_diff',
		mcpServerName: mcpServers[0],
		mcpConfigServerName: mcpServers[0],
		mcpTransport: 'http',
		mcpConfigSource: 'user',
		mcpToolName: 'read_diff'
	});
	say('model.call_final_result', { model, isByok: true, result: 'success' }, true);
};

const answerTurn = (turn, messageId, answer, thought) => {
	say('model.call_start', { turnId: String(turn), model }, true);
	if (thought) say('assistant.reasoning_delta', { reasoningId: thought.id, deltaContent: thought.delta }, true);
	say('assistant.message_start', { messageId }, true);
	for (const piece of [answer.slice(0, 4), answer.slice(4)]) {
		say('assistant.message_delta', { messageId, deltaContent: piece }, true);
	}
	callFinished(turn);
	say('assistant.message', {
		messageId,
		originatingMessageId: originatingId,
		model,
		content: answer,
		toolRequests: [],
		interactionId,
		turnId: String(turn),
		rte: false,
		apiCallId: 'chatcmpl-1',
		...(thought ? { reasoningText: thought.delta } : {})
	});
	if (thought) {
		say(
			'assistant.reasoning',
			{
				reasoningId: thought.id,
				content: thought.delta,
				rte: false,
				turnId: String(turn),
				apiCallId: 'chatcmpl-1',
				model,
				isByok: true
			},
			true
		);
	}
	say('model.call_final_result', { model, isByok: true, result: 'success' }, true);
	say('assistant.turn_end', { turnId: String(turn) });
};

if (mode === 'tool') {
	callTurn(0, 'm1', [{ name: mcpServers[0] + '-read_diff', arguments: { path: 'file0.ts' } }]);
	${TOOL_CALL}
	say('assistant.turn_end', { turnId: '0' });
	say('assistant.turn_start', { turnId: '1', interactionId, agentMode: 'interactive' });
	const answer = JSON.stringify({ done: true, results: [{ isError: false, text }] });
	answerTurn(1, 'm2', answer);
	finish(0);
} else {
	answerTurn(0, 'm1', 'the reply', { id: 'r1', delta: 'Hmm.' });
	finish(0);
}
`;

/**
 * The failure each `FAKE_COPILOT_MODE` produces, shared by the `complete()` and run-prompt contract tests: the
 * sign-in hint names `gh auth login`, the usage cap is a {@link UsageLimitError}, and the crash is an
 * {@link LlmError} quoting stderr.
 */
export const COPILOT_FAILURES: CallFailure[] = [
	{ mode: 'auth', status: 401, message: /gh auth login/, error: LlmError },
	{ mode: 'limit', status: 429, message: /resets at 3pm/, error: UsageLimitError },
	{ mode: 'crash', status: 0, message: /boom/, error: LlmError }
];

/** The user's own Copilot config the fake gets unless a test passes another: a hook and an MCP server. */
const USER_SETTINGS = {
	hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'touch /tmp/pwned' }] }] },
	mcpServers: { mine: { type: 'http', url: 'https://mine.example' } }
};

/** A fake `copilot` on PATH, with its log files and a user config home holding `USER_SETTINGS`. */
export async function fakeCopilot(extra: Record<string, string> = {}): Promise<Record<string, string | undefined>> {
	const { env } = await fakeBin('copilot', SCRIPT);
	const dir = await mkdtemp(join(tmpdir(), 'fake-copilot-'));
	const log = join(dir, 'log');

	await mkdir(join(dir, '.copilot'), { recursive: true });
	await writeFile(join(dir, '.copilot', 'settings.json'), JSON.stringify(USER_SETTINGS));

	return { ...env, HOME: dir, FAKE_COPILOT_LOG: log, ...extra };
}
