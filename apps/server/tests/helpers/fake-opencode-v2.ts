import { useFakeOpenCode } from './fake-opencode';

/**
 * A fake `opencode` 2.x. Like the real one it answers only under `/api` (the old root routes give the
 * app's HTML page on GET and 405 on POST), wraps replies in `{ data }`, queues a prompt and ends the turn with an
 * `idle` message that `wait` and the message list report. The reply depends on the prompt: `denied`
 * (a provider's 403), `auth`, `slow` (runs until interrupted) and `no-wait` (the wait route answers 503).
 * Every turn announces its step twice, as a retried provider call does. `/test/calls` lists every request.
 */
const SCRIPT = `#!/usr/bin/env bun
const [cmd] = process.argv.slice(2);
if (cmd === '--version') { console.log('opencode v2.0.6'); process.exit(0); }
const calls = [];
const streams = new Set();
const encoder = new TextEncoder();
const sessions = {};
const attempts = { att_1: 0 };
const mcp = {};
let count = 0;
let made = 0;

const emit = (type, data) => {
	for (const stream of streams) stream.enqueue(encoder.encode('data: ' + JSON.stringify({ id: 'evt_' + ++count, type, created: 0, data }) + '\\n\\n'));
};

const tokens = { input: 10, output: 4, reasoning: 2, cache: { read: 1, write: 0 } };
const failures = {
	denied: { type: 'provider.http', message: 'Free tier is not available here.', status: 403 },
	auth: { type: 'provider.auth', message: 'Key revoked' }
};

function finish(session, assistant, outcome, message) {
	session.messages.push({ id: assistant, type: 'assistant', content: message.content ?? [], tokens: message.error ? undefined : tokens, ...message });
	session.messages.push({ id: 'msg_' + ++count, type: 'idle', outcome });
	session.running = false;
	for (const release of session.waiters.splice(0)) release();
}

async function run(id, session, text) {
	const assistant = 'msg_' + ++count;
	emit('session.step.started', { sessionID: id, assistantMessageID: assistant });
	emit('session.step.started', { sessionID: id, assistantMessageID: assistant });
	if (text === 'slow') {
		await new Promise((resolve) => (session.interrupt = resolve));
		emit('session.execution.interrupted', { sessionID: id });
		return finish(session, assistant, 'interrupted', { error: { type: 'aborted', message: 'Step interrupted' } });
	}
	if (failures[text]) return finish(session, assistant, 'failed', { error: failures[text] });
	emit('session.reasoning.delta', { sessionID: id, assistantMessageID: assistant, ordinal: 0, delta: 'Thinking' });
	emit('session.text.delta', { sessionID: 'other', assistantMessageID: assistant, ordinal: 1, delta: 'Leak' });
	emit('session.text.delta', { sessionID: id, assistantMessageID: assistant, ordinal: 1, delta: 'Hello' });
	await Bun.sleep(30);
	emit('session.step.ended', { sessionID: id, assistantMessageID: assistant, finish: 'stop', tokens });
	finish(session, assistant, 'succeeded', { content: [{ type: 'text', text: 'Hello' }, { type: 'text', text: ' world' }] });
}

const server = Bun.serve({ port: 0, hostname: '127.0.0.1', idleTimeout: 0, async fetch(req) {
	if (req.headers.get('authorization') !== 'Basic ' + btoa('opencode:' + process.env.OPENCODE_SERVER_PASSWORD)) return new Response('no', { status: 401 });
	const url = new URL(req.url);
	const path = url.pathname;
	if (path === '/test/calls') return Response.json(calls);
	if (!path.startsWith('/api/')) return req.method === 'GET' ? new Response('<html></html>', { headers: { 'content-type': 'text/html' } }) : new Response(null, { status: 405 });
	const body = req.method === 'GET' || req.method === 'DELETE' ? null : await req.json().catch(() => null);
	calls.push({ method: req.method, path, body, query: url.search });
	const data = (value) => Response.json({ data: value });
	const none = () => new Response(null, { status: 204 });
	if (path === '/api/event') {
		let self;
		return new Response(new ReadableStream({
			start(controller) { self = controller; streams.add(controller); emit('server.connected', {}); },
			cancel() { streams.delete(self); }
		}), { headers: { 'content-type': 'text/event-stream' } });
	}
	if (path === '/api/model') return data([{ providerID: 'openai', modelID: 'm', name: 'M', status: 'active', capabilities: { tools: true }, variants: [{ id: 'high' }], limit: { context: 1000 } }]);
	if (path === '/api/integration') return data([
		{ id: 'openai', name: 'OpenAI', methods: [{ type: 'key', label: 'API key', form: [{ key: 'resourceName', type: 'string', title: 'Resource Name', placeholder: 'my-models' }] }, { type: 'env', names: ['OPENAI_API_KEY'] }, { id: 'device', type: 'oauth', label: 'ChatGPT' }], connections: [{ type: 'credential', id: 'cred_1', label: 'OAuth' }] }
	]);
	if (path.endsWith('/connect/key') || path.startsWith('/api/credential/') || path.endsWith('/complete')) return none();
	if (path === '/api/integration/openai/connect/oauth') return data({ attemptID: 'att_1', url: 'https://example.test/device', instructions: 'Enter code: ABCD', mode: 'auto' });
	if (path === '/api/integration/openai/connect/oauth/att_1') return data({ status: attempts.att_1++ ? 'complete' : 'pending' });
	if (path.startsWith('/api/experimental/mcp/') && req.method === 'PUT') { mcp[path.split('/').pop()] = 0; return none(); }
	if (path === '/api/mcp') return data(Object.keys(mcp).map((name) => ({ name, status: { status: mcp[name]++ ? 'connected' : 'pending' } })));
	if (path === '/api/session' && req.method === 'POST') {
		const id = 'ses_' + ++made;
		sessions[id] = { messages: [], waiters: [], running: false };
		return data({ id });
	}
	if (path.endsWith('/instructions/entries/recoder')) return none();
	const match = path.match(/^\\/api\\/(?:experimental\\/)?session\\/([^/]+)(\\/[^/]+)?/);
	const session = match && sessions[match[1]];
	if (!session) return new Response('missing', { status: 404 });
	if (match[2] === '/prompt') {
		const id = 'msg_' + ++count;
		session.messages.push({ id, type: 'user', text: body.text });
		session.running = true;
		session.noWait = body.text === 'no-wait';
		void run(match[1], session, body.text);
		return data({ id, sessionID: match[1] });
	}
	if (match[2] === '/wait') {
		if (session.noWait) return new Response('busy', { status: 503 });
		if (session.running) await new Promise((resolve) => session.waiters.push(resolve));
		return none();
	}
	if (match[2] === '/message') return data(session.messages.slice().reverse());
	if (match[2] === '/interrupt') { session.interrupt?.(); return Response.json({ interrupted: true }); }
	if (req.method === 'DELETE') { delete sessions[match[1]]; return none(); }
	return data({});
} });
console.log('opencode server listening on http://127.0.0.1:' + server.port);
`;

/** The fake's source, for a test that puts the binary somewhere of its own. */
export function fakeOpenCodeV2Script(): string {
	return SCRIPT;
}

/** For a test file: starts an agent on the fake OpenCode 2, and stops it after each test. */
export function useFakeOpenCodeV2(): ReturnType<typeof useFakeOpenCode> {
	return useFakeOpenCode(SCRIPT);
}
