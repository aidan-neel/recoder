import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatGptAuth, type ChatGptFetch } from './chatgpt-auth';
import { ChatGptProvider, codex } from './codex';
import { LlmError, chatCompletion, streamChatCompletion } from './llm';
import { db, reviewMetrics } from '../store';
import { getReviewMetrics, withReviewMetrics } from './metrics';
import { configForRole } from './models';
import { initReviewSettings, saveReviewSettings, setReviewOverrides } from './review-settings';

const providers: ChatGptProvider[] = [];
const directories: string[] = [];
afterEach(() => {
	for (const provider of providers.splice(0)) provider.stop();
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
	setReviewOverrides({});
});

const now = 1_900_000_000_000;
const jwt = (claims: unknown) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test-signature`;
const token = (suffix = '') => jwt({ exp: now / 1000 + 3600, test: suffix, 'https://api.openai.com/auth': { chatgpt_account_id: 'account-test', chatgpt_plan_type: 'plus' } });
const tokens = (suffix = '') => ({ access_token: token(suffix), refresh_token: `private-refresh${suffix}`, id_token: jwt({ email: 'tester@example.test', 'https://api.openai.com/auth': { chatgpt_account_id: 'account-test', chatgpt_plan_type: 'plus' } }), expires_in: 3600 });
const input = { provider: 'codex' as const, baseUrl: 'https://must-not-receive-oauth.test', apiKey: 'must-not-use-api-key', model: 'test-model', messages: [{ role: 'user' as const, content: 'Review this change' }], timeoutMs: 1000 };
const usage = { input_tokens: 100, output_tokens: 30, total_tokens: 130, input_tokens_details: { cached_tokens: 20, cache_write_tokens: 5 }, output_tokens_details: { reasoning_tokens: 10 } };
const finalItem = { id: 'answer', type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: '{"findings":[]}' }] };
const completeEvent = (extra: Record<string, unknown> = {}) => ({ type: 'response.completed', response: { status: 'completed', output: [finalItem], ...extra } });
function sse(events: unknown[]): Response {
	return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}

type Call = { url: string; init: RequestInit; headers: Headers; body: any };
function fixture(options: { authenticated?: boolean; expired?: boolean; handler?: (call: Call) => Response | undefined | Promise<Response | undefined> } = {}) {
	const directory = mkdtempSync(join(tmpdir(), 'recoder-chatgpt-'));
	directories.push(directory);
	const file = join(directory, 'chatgpt-auth.json');
	const calls: Call[] = [];
	let clock = now;
	if (options.authenticated !== false) writeFileSync(file, JSON.stringify({ version: 1, credentials: {
		accessToken: token(), refreshToken: 'private-refresh', accountId: 'account-test',
		expiresAt: now + (options.expired ? -1000 : 3600_000), email: 'tester@example.test', planType: 'plus'
	} }), { mode: 0o600 });
	const http: ChatGptFetch = async (url, init = {}) => {
		const headers = new Headers(init.headers);
		const body = headers.get('content-type') === 'application/x-www-form-urlencoded'
			? Object.fromEntries(new URLSearchParams(init.body as string)) : init.body ? JSON.parse(init.body as string) : undefined;
		const call = { url, init, headers, body };
		calls.push(call);
		const override = await options.handler?.(call);
		if (override) return override;
		if (url.endsWith('/deviceauth/usercode')) return Response.json({ device_auth_id: 'private-device-id', user_code: 'TEST-CODE', interval: '5' });
		if (url.endsWith('/deviceauth/token')) return Response.json({ authorization_code: 'private-code', code_verifier: 'private-verifier' });
		if (url.endsWith('/oauth/token')) return Response.json(tokens('-new'));
		if (url.endsWith('/wham/usage')) return Response.json({ plan_type: 'plus', rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_at: 1900001000 } }, additional_rate_limits: [{ limit_name: 'Spark', rate_limit: { secondary_window: { used_percent: 40, limit_window_seconds: 604800, reset_at: 1900002000 } } }] });
		if (url.includes('/codex/models?')) return Response.json({ models: [{ slug: 'test-model', display_name: 'Test model', visibility: 'list' }, { slug: 'hidden', visibility: 'hide' }] });
		if (url.endsWith('/codex/responses')) return sse([completeEvent({ usage })]);
		throw new Error(`Unexpected test request: ${url}`);
	};
	const auth = new ChatGptAuth(http, () => directory, () => clock);
	const provider = new ChatGptProvider(auth);
	providers.push(provider);
	return { auth, provider, calls, directory, file, http, advance: (ms: number) => { clock += ms; } };
}

test('device OAuth returns only public login fields and persists credentials with restrictive permissions', async () => {
	const f = fixture({ authenticated: false });
	const [connection, concurrent] = await Promise.all([f.provider.connect(), f.provider.connect()]);
	expect(connection).toEqual(concurrent);
	expect(connection.login).toEqual({ verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'TEST-CODE', expiresAt: now + 15 * 60_000 });
	expect(JSON.stringify(connection)).not.toContain('private-device-id');
	expect(f.calls).toHaveLength(1);
	expect(f.calls[0]!.body.client_id).toBe('app_EMoamEEZ73f0CkXaXp7hrann');
	await f.auth.status();
	expect(f.calls).toHaveLength(1); // Honor issuer polling interval.
	f.advance(5000);
	expect(await f.provider.status()).toMatchObject({ authenticated: true, email: 'tester@example.test', planType: 'plus' });
	const poll = f.calls.find((call) => call.url.endsWith('/deviceauth/token'))!;
	expect(poll.body).toEqual({ device_auth_id: 'private-device-id', user_code: 'TEST-CODE' });
	const exchange = f.calls.find((call) => call.url.endsWith('/oauth/token'))!;
	expect(exchange.body).toMatchObject({ grant_type: 'authorization_code', code: 'private-code', code_verifier: 'private-verifier', redirect_uri: 'https://auth.openai.com/deviceauth/callback' });
	expect(statSync(f.file).mode & 0o777).toBe(0o600);
	expect(JSON.parse(readFileSync(f.file, 'utf8')).credentials.refreshToken).toBe('private-refresh-new');
	const reopened = new ChatGptProvider(new ChatGptAuth(f.http, () => f.directory, () => now));
	providers.push(reopened);
	expect((await reopened.status()).authenticated).toBe(true);
	const publicData = JSON.stringify(await reopened.status());
	for (const secret of ['private-refresh', 'private-code', 'private-verifier', 'accessToken', 'account-test']) expect(publicData).not.toContain(secret);
});

test.each([403, 404])('device polling treats HTTP %s as pending, then succeeds', async (status) => {
	let pending = true;
	const f = fixture({ authenticated: false, handler: (call) => call.url.endsWith('/deviceauth/token') && pending ? new Response('', { status }) : undefined });
	await f.provider.connect(); f.advance(5000);
	expect((await f.auth.status()).login?.userCode).toBe('TEST-CODE');
	pending = false; f.advance(5000);
	expect((await f.auth.status()).authenticated).toBe(true);
});

test('pending device login expires and cancellation prevents subsequent polling', async () => {
	const f = fixture({ authenticated: false });
	await f.provider.connect(); f.advance(15 * 60_000);
	expect(await f.auth.status()).toMatchObject({ authenticated: false, error: expect.stringContaining('expired') });
	expect(f.calls).toHaveLength(1);
	await f.provider.connect();
	await f.provider.disconnect(); f.advance(5000);
	expect((await f.auth.status()).login).toBeUndefined();
	expect(f.calls.filter((call) => call.url.endsWith('/deviceauth/token'))).toHaveLength(0);
});

test('disconnect during an in-flight OAuth exchange cannot restore credentials', async () => {
	let release!: (response: Response) => void;
	const f = fixture({ authenticated: false, handler: (call) => call.url.endsWith('/oauth/token') ? new Promise<Response>((resolve) => { release = resolve; }) : undefined });
	await f.provider.connect(); f.advance(5000);
	const polling = f.auth.status();
	while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
	await f.provider.disconnect();
	release(Response.json(tokens()));
	await polling;
	expect(JSON.parse(readFileSync(f.file, 'utf8')).credentials).toBeNull();
	expect((await f.provider.status()).authenticated).toBe(false);
});

test('device errors do not expose provider bodies containing credentials', async () => {
	const f = fixture({ authenticated: false, handler: (call) => call.url.endsWith('/deviceauth/usercode') ? Response.json({ access_token: 'private-token', error: 'private-token' }, { status: 500 }) : undefined });
	await expect(f.provider.connect()).rejects.toThrow('HTTP 500');
	try { await f.provider.connect(); } catch (error) { expect(String(error)).not.toContain('private-token'); }
});

test('Recoder-owned legacy login migrates once; disconnect never resurrects it', async () => {
	const f = fixture({ authenticated: false });
	mkdirSync(join(f.directory, 'codex'));
	writeFileSync(join(f.directory, 'codex', 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', OPENAI_API_KEY: 'ignore-this', tokens: tokens() }));
	expect((await f.provider.status()).authenticated).toBe(true);
	expect(statSync(f.file).mode & 0o777).toBe(0o600);
	expect(readFileSync(f.file, 'utf8')).not.toContain('ignore-this');
	await f.provider.disconnect();
	const reopened = new ChatGptProvider(new ChatGptAuth(f.http, () => f.directory, () => now)); providers.push(reopened);
	expect((await reopened.status()).authenticated).toBe(false);
});

test('concurrent expired-token requests share one refresh and save token rotation', async () => {
	const f = fixture({ expired: true });
	await Promise.all([f.provider.complete(input), f.provider.complete(input), f.provider.models()]);
	expect(f.calls.filter((call) => call.url.endsWith('/oauth/token'))).toHaveLength(1);
	for (const call of f.calls.filter((call) => call.url.includes('chatgpt.com'))) {
		expect(call.headers.get('authorization')).toBe(`Bearer ${token('-new')}`);
		expect(call.headers.get('ChatGPT-Account-Id')).toBe('account-test');
		expect(call.init.redirect).toBe('error');
	}
	expect(JSON.parse(readFileSync(f.file, 'utf8')).credentials.refreshToken).toBe('private-refresh-new');
});

test('a 401 refreshes once and retries the same request without API fallback', async () => {
	const f = fixture({ handler: (call) => call.url.endsWith('/responses') && call.headers.get('authorization') === `Bearer ${token()}` ? new Response('', { status: 401 }) : undefined });
	expect(await f.provider.complete(input)).toBe('{"findings":[]}');
	expect(f.calls.filter((call) => call.url.endsWith('/responses'))).toHaveLength(2);
	expect(f.calls.filter((call) => call.url.endsWith('/oauth/token'))).toHaveLength(1);
	expect(f.calls.every((call) => !call.url.includes('must-not-receive-oauth'))).toBe(true);
	expect(f.calls.every((call) => call.headers.get('authorization') !== `Bearer ${input.apiKey}`)).toBe(true);
});

test('repeated 401 requires sign-in rather than a refresh loop', async () => {
	const f = fixture({ handler: (call) => call.url.endsWith('/responses') ? new Response('', { status: 401 }) : undefined });
	await expect(f.provider.complete(input)).rejects.toThrow('Sign in again');
	expect(f.calls.filter((call) => call.url.endsWith('/oauth/token'))).toHaveLength(1);
	expect((await f.provider.status()).authenticated).toBe(false);
});

test.each([400, 401, 403, 500])('refresh HTTP %s gives actionable errors and preserves credentials only on transient failure', async (status) => {
	const f = fixture({ expired: true, handler: (call) => call.url.endsWith('/oauth/token') ? Response.json({ error: 'private-refresh' }, { status }) : undefined });
	await expect(f.provider.complete(input)).rejects.toThrow(status === 500 ? 'HTTP 500' : 'Sign in again');
	const stored = JSON.parse(readFileSync(f.file, 'utf8')).credentials;
	expect(Boolean(stored)).toBe(status === 500);
	expect(f.calls.some((call) => call.url.endsWith('/responses'))).toBe(false);
});

test('refresh retains the previous refresh token when rotation is omitted', async () => {
	const f = fixture({ expired: true, handler: (call) => call.url.endsWith('/oauth/token') ? Response.json({ access_token: token('-new'), expires_in: 3600 }) : undefined });
	await f.provider.complete(input);
	expect(JSON.parse(readFileSync(f.file, 'utf8')).credentials.refreshToken).toBe('private-refresh');
});

test('direct Responses requests preserve roles and effort without unsupported API-key parameters', async () => {
	const f = fixture();
	await f.provider.complete({ ...input, jsonMode: true, maxTokens: 123, temperature: 0.1, seed: 7, messages: [
		{ role: 'system', content: 'Review carefully' }, { role: 'user', content: 'Change' }, { role: 'assistant', content: 'Earlier answer' }, { role: 'user', content: 'Follow up' }
	] });
	const call = f.calls.find((call) => call.url.endsWith('/responses'))!;
	expect(call.url).toBe('https://chatgpt.com/backend-api/codex/responses');
	expect(call.body).toMatchObject({ model: 'test-model', store: false, stream: true, reasoning: { effort: 'low' }, tools: [], tool_choice: 'none' });
	expect(call.body.instructions).toContain('Review carefully');
	expect(call.body.instructions).toContain('valid JSON');
	expect(call.body.input.map((item: any) => item.role)).toEqual(['user', 'assistant', 'user']);
	expect(call.body.input[1].content).toEqual([{ type: 'output_text', text: 'Earlier answer' }]);
	for (const key of ['max_output_tokens', 'max_tokens', 'temperature', 'seed']) expect(call.body[key]).toBeUndefined();
});

test.each(['low', 'medium', 'high'] as const)('direct model request consumes persisted role effort %s', async (reasoningEffort) => {
	setReviewOverrides({ models: [{ id: 'sub', label: 'ChatGPT', model: 'test-model', provider: 'codex' }], roleEfforts: { security: reasoningEffort } });
	const f = fixture();
	await f.provider.complete({ ...input, ...configForRole('security') });
	expect(f.calls.find((call) => call.url.endsWith('/responses'))!.body.reasoning.effort).toBe(reasoningEffort);
});

test('existing codex model routing persists without an API key or endpoint', () => {
	saveReviewSettings({ models: [{ id: 'sub', label: 'ChatGPT', model: 'test-model', provider: 'codex', apiKey: 'must-not-be-saved' }], sharedModelId: 'sub' });
	setReviewOverrides({}); initReviewSettings();
	expect(configForRole('correctness')).toMatchObject({ provider: 'codex', baseUrl: '', apiKey: '', model: 'test-model' });
});

test('disconnected provider fails before any model request', async () => {
	const f = fixture({ authenticated: false });
	await expect(f.provider.complete(input)).rejects.toThrow('Sign in to ChatGPT');
	expect(f.calls).toEqual([]);
});

test('account usage and model discovery use direct endpoints and hide non-listed models', async () => {
	const f = fixture();
	expect((await f.provider.status()).limits).toEqual([
		{ name: 'Codex · 300 min', usedPercent: 25, resetsAt: 1900001000 },
		{ name: 'Spark · 10080 min', usedPercent: 40, resetsAt: 1900002000 }
	]);
	expect(await f.provider.models()).toEqual([{ id: 'test-model', label: 'Test model' }]);
});

test('usage failure preserves login and reports its own error, not App Server unavailable', async () => {
	const f = fixture({ handler: (call) => call.url.endsWith('/wham/usage') ? new Response('', { status: 503 }) : undefined });
	expect(await f.provider.status()).toMatchObject({ available: true, authenticated: true, error: expect.stringContaining('HTTP 503') });
	expect(await f.provider.complete(input)).toBe('{"findings":[]}');
});

test('fragmented SSE streams only final-answer text and reports exact cache/reasoning usage once', async () => {
	const commentary = { id: 'commentary', type: 'message', role: 'assistant', phase: 'commentary' };
	const events = [
		{ type: 'response.output_item.added', item: commentary },
		{ type: 'response.output_text.delta', item_id: 'commentary', delta: 'not the answer' },
		{ type: 'response.reasoning_text.delta', delta: 'private reasoning' },
		{ type: 'response.output_item.added', item: { ...finalItem, content: [] } },
		{ type: 'response.output_text.delta', item_id: 'answer', delta: 'Hé' },
		{ type: 'response.output_text.delta', item_id: 'answer', delta: 'llo' },
		completeEvent({ usage, output: [{ ...finalItem, content: [{ type: 'output_text', text: 'Héllo' }] }] })
	];
	const wire = events.map((event) => `: heartbeat\r\nevent: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join('');
	const f = fixture({ handler: (call) => call.url.endsWith('/responses') ? new Response(new ReadableStream({ start(controller) {
		const bytes = new TextEncoder().encode(wire);
		for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
		controller.close();
	} })) : undefined });
	const output: string[] = []; const reports: unknown[] = [];
	expect(await f.provider.complete({ ...input, onUsage: (value) => reports.push(value) }, (value) => output.push(value))).toBe('Héllo');
	expect(output).toEqual(['Hé', 'llo']);
	expect(reports).toEqual([{ inputTokens: 100, outputTokens: 30, totalTokens: 130, cachedInputTokens: 20, cacheWriteInputTokens: 5, reasoningOutputTokens: 10 }]);
});

test('terminal SSE without trailing newline keeps output; missing usage is not fabricated', async () => {
	const f = fixture({ handler: (call) => call.url.endsWith('/responses') ? new Response(`data: ${JSON.stringify(completeEvent())}`) : undefined });
	const reports: unknown[] = [];
	expect(await f.provider.complete({ ...input, onUsage: (value) => reports.push(value) })).toBe('{"findings":[]}');
	expect(reports).toEqual([]);
});

test('ChatGPT requests reasoning summaries and deduplicates delta, done and terminal representations', async () => {
	const item = { id: 'reasoning-1', type: 'reasoning', summary: [{ type: 'summary_text', text: 'Checking callers.' }] };
	const f = fixture({ handler: (call) => call.url.endsWith('/responses') ? sse([
		{ type: 'response.reasoning_summary_text.delta', item_id: item.id, summary_index: 0, delta: 'Checking ' },
		{ type: 'response.reasoning_summary_text.delta', item_id: item.id, summary_index: 0, delta: 'callers.' },
		{ type: 'response.reasoning_summary_text.done', item_id: item.id, summary_index: 0, text: 'Checking callers.' },
		{ type: 'response.output_item.done', item },
		completeEvent({ output: [item, { id: 'reasoning-2', type: 'reasoning', summary: [{ type: 'summary_text', text: 'Compared the old behavior.' }] }, finalItem] })
	]) : undefined });
	const reasoning: string[] = [];
	expect(await f.provider.complete({ ...input, onReasoning: (text) => reasoning.push(text) })).toBe('{"findings":[]}');
	expect(f.calls.find((call) => call.url.endsWith('/responses'))!.body.reasoning.summary).toBe('auto');
	expect(reasoning.join('')).toBe('Checking callers.\n\nCompared the old behavior.');
});

test.each(['response.failed', 'response.incomplete'])('%s retains usage but rejects partial output', async (type) => {
	const f = fixture({ handler: (call) => call.url.endsWith('/responses') ? sse([{ type, response: { usage, status: 'failed', incomplete_details: { reason: 'max_output_tokens' } } }]) : undefined });
	const reports: unknown[] = [];
	await expect(f.provider.complete({ ...input, onUsage: (value) => reports.push(value) })).rejects.toBeInstanceOf(LlmError);
	expect(reports).toHaveLength(1);
	expect(reports[0]).toMatchObject({ totalTokens: 130 });
});

test('truncated streams and malformed SSE cannot be mistaken for successful responses', async () => {
	for (const wire of ['data: {"type":"response.output_text.delta","delta":"partial"}\n\n', 'data: [DONE]\n\n', 'data: invalid-json\n\n']) {
		const f = fixture({ handler: (call) => call.url.endsWith('/responses') ? new Response(wire) : undefined });
		await expect(f.provider.complete(input)).rejects.toBeInstanceOf(LlmError);
	}
});

test('abort cancels streaming and releases the active request; disconnect waits for completion', async () => {
	let cancelled = false;
	const f = fixture({ handler: (call) => call.url.endsWith('/responses') ? new Response(new ReadableStream({ cancel() { cancelled = true; } })) : undefined });
	const controller = new AbortController();
	const work = f.provider.complete({ ...input, signal: controller.signal });
	const outcome = work.catch((error: Error) => error.message);
	while (!f.calls.some((call) => call.url.endsWith('/responses'))) await new Promise((resolve) => setTimeout(resolve, 1));
	await expect(f.provider.disconnect()).rejects.toThrow('active ChatGPT');
	controller.abort();
	expect(await outcome).toContain('cancelled');
	expect(cancelled).toBe(true);
	await f.provider.disconnect();
});

test('a caller deadline also bounds waiting for a shared token refresh', async () => {
	let release!: (response: Response) => void;
	const f = fixture({ expired: true, handler: (call) => call.url.endsWith('/oauth/token') ? new Promise<Response>((resolve) => { release = resolve; }) : undefined });
	const controller = new AbortController();
	const work = f.provider.complete({ ...input, signal: controller.signal });
	const outcome = work.catch((error: Error) => error.message);
	while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
	controller.abort();
	expect(await outcome).toContain('cancelled');
	expect(f.calls.some((call) => call.url.endsWith('/responses'))).toBe(false);
	await f.provider.disconnect();
	release(Response.json(tokens()));
	await new Promise((resolve) => setTimeout(resolve, 1));
	expect(JSON.parse(readFileSync(f.file, 'utf8')).credentials).toBeNull();
});

test('harness completion and streaming use direct HTTP, count once each and preserve HTTP failure status', async () => {
	let limited = false;
	const f = fixture({ handler: (call) => {
		if (!call.url.endsWith('/responses')) return undefined;
		if (limited) return new Response('', { status: 429 });
		return sse([
			{ type: 'response.output_item.added', item: { ...finalItem, content: [] } },
			{ type: 'response.output_text.delta', item_id: 'answer', delta: '{"findings":' },
			{ type: 'response.output_text.delta', item_id: 'answer', delta: '[]}' },
			completeEvent({ usage })
		]);
	} });
	const original = codex.complete;
	codex.complete = f.provider.complete.bind(f.provider);
	const id = crypto.randomUUID();
	db.reviews.set({ id, repoId: 'test', prNumber: 1, headSha: 'test', status: 'passed', summary: null, findings: [], runs: [], source: 'github', prTitle: null, prUrl: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
	try {
		await withReviewMetrics(id, 'pipeline', () => chatCompletion(input));
		const chunks: string[] = [];
		await withReviewMetrics(id, 'discussion', () => streamChatCompletion(input, (text) => chunks.push(text)));
		expect(chunks).toEqual(['{"findings":', '[]}']);
		expect(getReviewMetrics(id)?.total).toMatchObject({ calls: 2, failedCalls: 0, usage: { inputTokens: 200, outputTokens: 60, totalTokens: 260, cachedInputTokens: 40, reasoningOutputTokens: 20 } });
		expect(getReviewMetrics(id)?.models).toHaveLength(1);
		limited = true;
		const error = await withReviewMetrics(id, 'pipeline', () => chatCompletion(input)).catch((error) => error);
		expect(error).toBeInstanceOf(LlmError);
		expect(error.status).toBe(429);
		expect(getReviewMetrics(id)?.total).toMatchObject({ calls: 3, failedCalls: 1, usage: { totalTokens: 260 } });
	} finally {
		codex.complete = original;
		db.reviews.delete(id); reviewMetrics.delete(id);
	}
});

test('model discovery reads effort levels and the default from the catalog', async () => {
	const f = fixture({
		handler: (call) => call.url.includes('/codex/models?')
			? Response.json({ models: [
				{
					slug: 'sol', display_name: 'GPT-5.6-Sol', visibility: 'list', default_reasoning_level: 'medium',
					supported_reasoning_levels: [
						{ effort: 'low', description: 'Fast' },
						{ effort: 'medium', description: 'Balanced' },
						{ effort: 'xhigh', description: 'Extra high' },
						{ effort: 'turbo', description: 'Unknown levels are ignored' }
					]
				},
				{ slug: 'legacy', visibility: 'list', supported_reasoning_efforts: ['minimal', 'high'] }
			] })
			: undefined
	});
	expect(await f.provider.models()).toEqual([
		{ id: 'sol', label: 'GPT-5.6-Sol', efforts: ['low', 'medium', 'xhigh'], defaultEffort: 'medium' },
		{ id: 'legacy', label: 'legacy', efforts: ['minimal', 'high'] }
	]);
});
