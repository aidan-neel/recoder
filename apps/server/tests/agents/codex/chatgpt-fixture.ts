import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatGptAuth, type ChatGptFetch } from '../../../src/agents/codex/chatgpt-auth';
import { ChatGptProvider } from '../../../src/agents/codex/codex';
import { setReviewOverrides } from '../../../src/review/session/review-settings';

/** One request the fake ChatGPT backend received, with its body decoded. */
type Call = { url: string; init: RequestInit; headers: Headers; body: Record<string, unknown> };

type Handler = (call: Call) => Response | undefined | Promise<Response | undefined>;

const providers: ChatGptProvider[] = [];
const directories: string[] = [];

/** Stop every provider and remove every data directory the tests created. Run after each test. */
export function cleanupFixtures(): void {
	for (const provider of providers.splice(0)) provider.stop();
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
	setReviewOverrides({});
}

export const now = 1_900_000_000_000;

const jwt = (claims: unknown) =>
	`eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test-signature`;

export const token = (suffix = '') =>
	jwt({
		exp: now / 1000 + 3600,
		test: suffix,
		'https://api.openai.com/auth': { chatgpt_account_id: 'account-test', chatgpt_plan_type: 'plus' }
	});

export const tokens = (suffix = '') => ({
	access_token: token(suffix),
	refresh_token: `private-refresh${suffix}`,
	id_token: jwt({
		email: 'tester@example.test',
		'https://api.openai.com/auth': { chatgpt_account_id: 'account-test', chatgpt_plan_type: 'plus' }
	}),
	expires_in: 3600
});

/** Saved credentials as they appear in the credentials file. */
export const storedCredentials = (accessToken: string, refreshToken: string, expiresAt: number) => ({
	accessToken,
	refreshToken,
	accountId: 'account-test',
	expiresAt,
	email: 'tester@example.test',
	planType: 'plus'
});

export const input = {
	provider: 'codex' as const,
	baseUrl: 'https://must-not-receive-oauth.test',
	apiKey: 'must-not-use-api-key',
	model: 'test-model',
	messages: [{ role: 'user' as const, content: 'Review this change' }],
	timeoutMs: 1000
};

export const usage = {
	input_tokens: 100,
	output_tokens: 30,
	total_tokens: 130,
	input_tokens_details: { cached_tokens: 20, cache_write_tokens: 5 },
	output_tokens_details: { reasoning_tokens: 10 }
};

export const finalItem = {
	id: 'answer',
	type: 'message',
	role: 'assistant',
	phase: 'final_answer',
	content: [{ type: 'output_text', text: '{"findings":[]}' }]
};

export const completeEvent = (extra: Record<string, unknown> = {}) => ({
	type: 'response.completed',
	response: { status: 'completed', output: [finalItem], ...extra }
});

export function sse(events: unknown[]): Response {
	return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
		headers: { 'content-type': 'text/event-stream' }
	});
}

/** Poll until `ready` holds, yielding to the event loop between checks. */
export async function until(ready: () => boolean): Promise<void> {
	while (!ready()) await new Promise((resolve) => setTimeout(resolve, 1));
}

/** Starts a completion the test can cancel through `controller`; `outcome` settles with the reply or the error message. */
export function cancellableCompletion(provider: ChatGptProvider) {
	const controller = new AbortController();
	const outcome = provider.complete({ ...input, signal: controller.signal }).catch((error: Error) => error.message);

	return { controller, outcome };
}

function decodeBody(headers: Headers, body: RequestInit['body']): Record<string, unknown> {
	if (headers.get('content-type') === 'application/x-www-form-urlencoded')
		return Object.fromEntries(new URLSearchParams(body as string));

	return body ? JSON.parse(body as string) : {};
}

/** The fake backend's default answer for each endpoint Recoder calls. */
function defaultResponse(url: string): Response {
	if (url.endsWith('/deviceauth/usercode'))
		return Response.json({ device_auth_id: 'private-device-id', user_code: 'TEST-CODE', interval: '5' });
	if (url.endsWith('/deviceauth/token'))
		return Response.json({ authorization_code: 'private-code', code_verifier: 'private-verifier' });
	if (url.endsWith('/oauth/token')) return Response.json(tokens('-new'));

	if (url.endsWith('/wham/usage'))
		return Response.json({
			plan_type: 'plus',
			rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_at: 1900001000 } },
			additional_rate_limits: [
				{
					limit_name: 'Spark',
					rate_limit: { secondary_window: { used_percent: 40, limit_window_seconds: 604800, reset_at: 1900002000 } }
				}
			]
		});

	if (url.includes('/codex/models?'))
		return Response.json({
			models: [
				{ slug: 'test-model', display_name: 'Test model', visibility: 'list' },
				{ slug: 'hidden', visibility: 'hide' }
			]
		});

	if (url.endsWith('/codex/responses')) return sse([completeEvent({ usage })]);
	throw new Error(`Unexpected test request: ${url}`);
}

/**
 * A ChatGPT provider on a temp data directory and a fake backend. `handler`
 * overrides the default answer for any request it returns a response for.
 */
export function fixture(options: { authenticated?: boolean; expired?: boolean; handler?: Handler } = {}) {
	const directory = mkdtempSync(join(tmpdir(), 'recoder-chatgpt-'));

	directories.push(directory);

	const file = join(directory, 'chatgpt-auth.json');
	const calls: Call[] = [];
	let clock = now;

	if (options.authenticated !== false)
		writeFileSync(
			file,
			JSON.stringify({
				version: 1,
				credentials: storedCredentials(token(), 'private-refresh', now + (options.expired ? -1000 : 3600_000))
			}),
			{ mode: 0o600 }
		);

	const http: ChatGptFetch = async (url, init = {}) => {
		const headers = new Headers(init.headers);
		const call = { url, init, headers, body: decodeBody(headers, init.body) };

		calls.push(call);

		return (await options.handler?.(call)) ?? defaultResponse(url);
	};

	const auth = new ChatGptAuth(
		http,
		() => directory,
		() => clock
	);

	const provider = new ChatGptProvider(auth);

	providers.push(provider);

	return {
		auth,
		provider,
		calls,
		directory,
		file,
		advance: (ms: number) => {
			clock += ms;
		},

		/** A second provider on the same data directory and backend, as after a restart. */
		reopen: () => {
			const reopened = new ChatGptProvider(
				new ChatGptAuth(
					http,
					() => directory,
					() => now
				)
			);

			providers.push(reopened);

			return reopened;
		},

		/** The credentials currently in the file, or `null` once signed out. */
		saved: (): { refreshToken?: string } | null => JSON.parse(readFileSync(file, 'utf8')).credentials
	};
}
