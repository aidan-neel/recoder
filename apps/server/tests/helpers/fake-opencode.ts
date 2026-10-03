import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fakeBin } from './fake-bin';

/**
 * The fake server's source. It checks the Basic auth password, serves the
 * provider and sign-in routes, and runs chat sessions whose reply depends on
 * the prompt: `structured`, `denied` (the free tier's 403), `auth`, `slow`, and
 * `auto-only` (refuses a schema like a provider that takes only `auto` tool choice) and
 * `empty-structured` (answers a schema with `{}`).
 * Like OpenCode, a schema request with `StructuredOutput` off fails.
 * Any other prompt streams "Hello" and " world" before replying. `/test/calls`
 * lists every chat request it saw.
 */
const SCRIPT = `#!/usr/bin/env bun
const [cmd] = process.argv.slice(2);
if (cmd === '--version') { console.log('1.2.3'); process.exit(0); }
const calls = [];
const streams = new Set();
const encoder = new TextEncoder();
let releaseCallback;
let sessions = 0;

const send = (event) => {
	for (const stream of streams) stream.enqueue(encoder.encode('data: ' + JSON.stringify(event) + '\\n\\n'));
};

const tokens = { input: 10, output: 4, reasoning: 2, cache: { read: 1, write: 0 } };

const replies = {
	structured: () => ({ info: { tokens, structured: { ok: true } }, parts: [] }),
	denied: () => ({ info: { error: { name: 'APIError', data: { message: 'Free tier is not available here.', statusCode: 403 } } }, parts: [] }),
	auth: () => ({ info: { error: { name: 'ProviderAuthError', data: { providerID: 'openai', message: 'Key revoked' } } }, parts: [] })
};

async function chat(session, body, signal) {
	const text = body.parts[0].text;
	if (body.format && body.tools.StructuredOutput !== true) return { info: { error: { name: 'StructuredOutputError', data: { message: 'Model did not produce structured output' } } }, parts: [] };
	if (text === 'auto-only') return body.format ? { info: { error: { name: 'APIError', data: { message: 'only \`"auto"\` is supported for \`tool_choice\`. \`"none"\`, \`"required"\`, and named function choices are not currently supported', statusCode: 400 } } }, parts: [] } : { info: { tokens }, parts: [{ type: 'text', text: '{"ok":true}' }] };
	if (text === 'empty-structured') return body.format ? { info: { tokens, structured: {} }, parts: [] } : { info: { tokens }, parts: [{ type: 'text', text: '{"ok":true}' }] };
	if (replies[text]) return replies[text]();
	if (text === 'slow') {
		await new Promise((resolve) => signal.addEventListener('abort', resolve));
		return { info: {}, parts: [] };
	}
	send({ type: 'message.part.updated', properties: { sessionID: session, part: { id: 'r1', type: 'reasoning', sessionID: session } } });
	send({ type: 'message.part.updated', properties: { sessionID: session, part: { id: 't1', type: 'text', sessionID: session } } });
	send({ type: 'message.part.delta', properties: { sessionID: session, partID: 'r1', field: 'text', delta: 'Thinking' } });
	send({ type: 'message.part.delta', properties: { sessionID: 'other', partID: 't1', field: 'text', delta: 'Leak' } });
	send({ type: 'message.part.delta', properties: { sessionID: session, partID: 't1', field: 'text', delta: 'Hello' } });
	await Bun.sleep(50);
	return { info: { tokens }, parts: [{ type: 'reasoning', text: 'Thinking' }, { type: 'text', text: 'Hello' }, { type: 'text', text: ' world' }] };
}

const server = Bun.serve({ port: 0, hostname: '127.0.0.1', idleTimeout: 0, async fetch(req) {
	if (req.headers.get('authorization') !== 'Basic ' + btoa('opencode:' + process.env.OPENCODE_SERVER_PASSWORD)) return new Response('no', { status: 401 });
	const path = new URL(req.url).pathname;
	if (path === '/provider') return Response.json({ all: [{ id: 'openai', name: 'OpenAI', models: {} }], connected: [] });
	if (path === '/config/providers') return Response.json({ providers: [{ id: 'openai', name: 'OpenAI', source: 'custom', models: { m: { id: 'm', name: 'M', variants: { high: {} } } } }] });
	if (path === '/provider/auth') return Response.json({ openai: [{ type: 'oauth', label: 'ChatGPT' }] });
	if (path === '/provider/openai/oauth/authorize') return Response.json({ url: 'https://example.test/device', method: 'auto', instructions: 'Enter code: ABCD' });
	if (path === '/provider/openai/oauth/callback') { await new Promise((r) => (releaseCallback = r)); return Response.json(true); }
	if (path === '/test/finish-browser') { releaseCallback?.(); return Response.json(true); }
	if (path === '/test/calls') return Response.json(calls);
	if (path === '/global/dispose') return Response.json(true);
	if (path === '/event') {
		let self;
		return new Response(new ReadableStream({
			start(controller) { self = controller; streams.add(controller); send({ type: 'server.connected', properties: {} }); },
			cancel() { streams.delete(self); }
		}), { headers: { 'content-type': 'text/event-stream' } });
	}
	const body = req.method === 'POST' ? await req.json().catch(() => null) : null;
	calls.push({ method: req.method, path, body });
	if (path === '/session' && req.method === 'POST') return Response.json({ id: 'ses_' + ++sessions });
	const match = path.match(/^\\/session\\/([^/]+)(\\/message|\\/abort)?$/);
	if (match && match[2] === '/message') return Response.json(await chat(match[1], body, req.signal));
	if (match) return Response.json(true);
	return new Response('missing', { status: 404 });
} });
console.log('opencode server listening on http://127.0.0.1:' + server.port);
`;

/** A fake `opencode` on PATH: prints a version, and `serve` runs a tiny password-checked API. */
export async function fakeOpenCode(): Promise<Record<string, string | undefined>> {
	const { env } = await fakeBin('opencode', SCRIPT);

	return { ...env, HOME: await mkdtemp(`${tmpdir()}/fake-opencode-home-`) };
}
