import { afterEach, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { spawn } from 'node:child_process';
import { CodexBridge } from './codex';
import { configForRole } from './models';
import { initReviewSettings, saveReviewSettings, setReviewOverrides } from './review-settings';

const bridges: CodexBridge[] = [];
afterEach(() => { for (const bridge of bridges.splice(0)) bridge.stop(); setReviewOverrides({}); });

function fixture(options: { authenticated?: boolean; hang?: boolean; usage?: boolean } = {}) {
	const messages: any[] = [];
	let authenticated = options.authenticated ?? true;
	let spawnOptions: any;
	let spawnArgs: string[] = [];
	const stdout = new PassThrough();
	const emit = (value: unknown) => stdout.write(JSON.stringify(value) + '\n');
	const child = Object.assign(new EventEmitter(), {
		stdout, stderr: new PassThrough(),
		stdin: new Writable({ write(chunk, _encoding, done) {
			for (const line of chunk.toString().trim().split('\n')) {
				const message = JSON.parse(line); messages.push(message);
				if (message.id === undefined || !message.method) continue;
				let result: unknown = {};
				switch (message.method) {
					case 'account/read': result = { account: authenticated ? { type: 'chatgpt', email: 'tester@example.test', planType: 'plus' } : null }; break;
					case 'account/login/start': result = { type: 'chatgptDeviceCode', loginId: 'private-login-id', userCode: 'TEST-CODE', verificationUrl: 'https://auth.openai.com/codex/device' }; break;
					case 'account/logout': authenticated = false; break;
					case 'account/rateLimits/read': result = { rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1900000000 } } }; break;
					case 'model/list': result = { data: [{ model: 'test-model', displayName: 'Test model' }], nextCursor: null }; break;
					case 'thread/start': result = { thread: { id: 'thread-test' } }; break;
					case 'turn/start':
						result = { turn: { id: 'turn-test' } };
						queueMicrotask(() => {
							emit({ method: 'turn/started', params: { threadId: 'thread-test', turn: { id: 'turn-test' } } });
							if (options.usage) {
								for (const inputTokens of [50, 100]) emit({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-test', turnId: 'turn-test', tokenUsage: { total: { inputTokens, outputTokens: 30, totalTokens: inputTokens + 30, cachedInputTokens: 20, cacheWriteInputTokens: 5, reasoningOutputTokens: 10 }, last: { inputTokens: 50, outputTokens: 15 } } } });
								emit({ method: 'thread/tokenUsage/updated', params: { threadId: 'other-thread', turnId: 'turn-test', tokenUsage: { total: { inputTokens: 999 } } } });
							}
							if (options.hang) return;
							emit({ method: 'item/completed', params: { threadId: 'thread-test', item: { type: 'agentMessage', phase: 'commentary', text: 'not the answer' } } });
							emit({ method: 'item/completed', params: { threadId: 'thread-test', item: { type: 'agentMessage', phase: 'final_answer', text: '{"findings":[]}' } } });
							emit({ method: 'turn/completed', params: { threadId: 'thread-test', turn: { id: 'turn-test', status: 'completed' } } });
						});
				}
				queueMicrotask(() => emit({ id: message.id, result }));
			}
			done();
		} }),
		kill() { stdout.end(); }
	});
	const spawnServer = ((_binary: string, args: string[], opts: unknown) => { spawnArgs = args; spawnOptions = opts; return child; }) as unknown as typeof spawn;
	const bridge = new CodexBridge(spawnServer);
	bridges.push(bridge);
	return { bridge, messages, emit, get environment() { return spawnOptions.env; }, get args() { return spawnArgs; } };
}

const input = { baseUrl: '', apiKey: '', model: 'test-model', messages: [{ role: 'user' as const, content: 'Review this change' }], timeoutMs: 1000 };

test('Codex exposes cumulative usage from its own thread, including cache and reasoning', async () => {
	const { bridge } = fixture({ usage: true });
	const reports: unknown[] = [];
	await bridge.complete({ ...input, onUsage: (usage) => reports.push(usage) });
	expect(reports).toHaveLength(2);
	expect(reports[1]).toEqual({ inputTokens: 100, outputTokens: 30, totalTokens: 130, cachedInputTokens: 20, cacheWriteInputTokens: 5, reasoningOutputTokens: 10 });
});

test('Codex does not invent usage when the server sends none', async () => {
	const { bridge } = fixture();
	const reports: unknown[] = [];
	await bridge.complete({ ...input, onUsage: (usage) => reports.push(usage) });
	expect(reports).toEqual([]);
});

test('Codex subscription routing persists without an API key or endpoint', () => {
	saveReviewSettings({ models: [{ id: 'sub', label: 'Subscription', model: 'test-model', provider: 'codex', apiKey: 'must-not-be-saved' }], sharedModelId: 'sub' });
	setReviewOverrides({});
	initReviewSettings();
	expect(configForRole('correctness')).toMatchObject({ provider: 'codex', baseUrl: '', apiKey: '', model: 'test-model' });
});

test('device login returns only public login fields and supports cancellation', async () => {
	const { bridge, messages } = fixture({ authenticated: false });
	const connection = await bridge.connect();
	expect(connection.login?.userCode).toBe('TEST-CODE');
	expect(JSON.stringify(connection)).not.toContain('private-login-id');
	await bridge.disconnect();
	expect(messages.some((message) => message.method === 'account/login/cancel')).toBe(true);
	expect((await bridge.status()).authenticated).toBe(false);
});

test('subscription completion uses safe thread configuration and only final text', async () => {
	const mocked = fixture();
	expect(await mocked.bridge.complete(input)).toBe('{"findings":[]}');
	expect(mocked.environment.OPENAI_API_KEY).toBeUndefined();
	expect(mocked.environment.GH_TOKEN).toBeUndefined();
	expect(mocked.environment.CODEX_HOME).toContain('codex');
	expect(mocked.args).toContain('shell_tool');
	expect(mocked.messages.find((message) => message.method === 'thread/start').params).toMatchObject({
		config: { model_reasoning_effort: 'low' },
		modelProvider: 'openai', allowProviderModelFallback: false, sandbox: 'read-only', approvalPolicy: 'never', environments: [], ephemeral: true
	});
	expect(mocked.messages.some((message) => message.method === 'thread/unsubscribe')).toBe(true);
});

test('missing subscription fails before any thread starts; no paid fallback', async () => {
	const { bridge, messages } = fixture({ authenticated: false });
	await expect(bridge.complete(input)).rejects.toThrow('API-key fallback is disabled');
	expect(messages.some((message) => message.method === 'thread/start')).toBe(false);
});

test.each(['low', 'medium', 'high'] as const)('Codex consumes the configured %s role effort', async (reasoningEffort) => {
	setReviewOverrides({
		models: [{ id: 'sub', label: 'Subscription', model: 'test-model', provider: 'codex' }],
		roleEfforts: { security: reasoningEffort }
	});
	const { bridge, messages } = fixture();
	await bridge.complete({ ...input, ...configForRole('security') });
	expect(messages.find((message) => message.method === 'thread/start').params.config.model_reasoning_effort).toBe(reasoningEffort);
});

test('account limits and model discovery expose no credentials', async () => {
	const { bridge } = fixture();
	expect((await bridge.status()).limits?.[0].usedPercent).toBe(25);
	expect(await bridge.models()).toEqual([{ id: 'test-model', label: 'Test model' }]);
});

test('aborting a model turn interrupts it and releases the thread', async () => {
	const { bridge, messages } = fixture({ hang: true });
	const controller = new AbortController();
	const work = bridge.complete({ ...input, signal: controller.signal });
	const result = work.then(() => '', (error: Error) => error.message);
	while (!messages.some((message) => message.method === 'turn/start')) await new Promise((resolve) => setTimeout(resolve, 1));
	await expect(bridge.disconnect()).rejects.toThrow('active Codex');
	controller.abort();
	expect(await result).toContain('cancelled or timed out');
	expect(messages.some((message) => message.method === 'turn/interrupt')).toBe(true);
});
