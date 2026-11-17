import { afterEach, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Repo, TokenUsage } from '@recoder/shared';
import type {
	AgentAdapter,
	AgentPromptOptions,
	AgentReply,
	AgentRun,
	AgentRunOptions,
	ToolOutcome
} from '../../src/agents/contract';
import { McpToolHost } from '../../src/agents/tools/mcp-host';
import { LlmError } from '../../src/models/llm';
import { answer } from '../../src/repo-chat/chat-reply';
import { MAX_REPLY_CHARS } from '../../src/repo-chat/chat-record';
import { CHAT_RUN_TIMEOUT_MS, CHAT_TOOLS, MAX_CHAT_TOOL_CALLS } from '../../src/repo-chat/chat-tools';
import { recoderSystemPrompt } from '../../src/repo-chat/identity';
import { reviewInstructions } from '../../src/review/chat/review-chat';
import { getStoredSettings, setReviewOverrides } from '../../src/review/session/review-settings';
import { db, modelCalls } from '../../src/store';
import { chatTempDir, chatting, committed, removeChatRepos } from '../helpers/chat-fixture';
import { localForgeFixture } from '../helpers/local-forge';

const SECRET = 'secret-outside-the-copy-7c1e';
const MARKER = 'export const MARKER = 1;\n';

afterEach(removeChatRepos);

interface Opened extends AgentRun {
	options: AgentRunOptions;
	promptText: string;
	promptOptions?: AgentPromptOptions;
	aborted: boolean;
	closed: boolean;
}

/** A fake adapter: `openRun` records its options, and `prompt` runs `script` and can emit events and tool calls. */
function scriptedAgent(
	script: (run: Opened) => Promise<AgentReply>,
	onOpen?: (options: AgentRunOptions) => Promise<void>
): { agent: AgentAdapter; runs: Opened[] } {
	const runs: Opened[] = [];

	const agent: AgentAdapter = {
		id: 'fake',
		name: 'Fake',
		processCeiling: null,
		signInFix: 'unused',
		readsImages: false,
		detect: () => Promise.reject(new Error('detect is not used')),
		quickStatus: () => Promise.reject(new Error('quickStatus is not used')),
		installed: () => false,
		models: () => Promise.reject(new Error('models is not used')),
		fixedModels: () => null,
		modelSettings: () => ({}),
		complete: () => Promise.reject(new Error('complete is not used')),
		setup: null,
		setupEnv: () => ({}),
		describeFailure: () => ({ reason: 'unused' }),
		stop: () => undefined,
		openRun: async (options) => {
			if (onOpen) await onOpen(options);

			let rejectPrompt: ((error: LlmError) => void) | undefined;

			const run: Opened = {
				options,
				promptText: '',
				aborted: false,
				closed: false,
				prompt: (text, promptOptions) => {
					run.promptText = text;
					run.promptOptions = promptOptions;

					return new Promise((resolve, reject) => {
						rejectPrompt = reject;
						void script(run).then(resolve, reject);
					});
				},
				abort: () => {
					run.aborted = true;
					rejectPrompt?.(new LlmError(0, 'cancelled'));

					return Promise.resolve();
				},
				close: () => {
					run.closed = true;

					return Promise.resolve();
				}
			};

			runs.push(run);

			return run;
		}
	};

	return { agent, runs };
}

function bareRepo(): Repo {
	const at = new Date().toISOString();

	return {
		id: crypto.randomUUID(),
		name: 'acme/shop',
		url: 'file:///tmp/recoder-chat-unused',
		provider: 'local',
		defaultBranch: 'main',
		createdAt: at,
		updatedAt: at
	};
}

const listedSchema = z.object({
	result: z.object({ tools: z.array(z.object({ name: z.string(), description: z.string() })) })
});

/** The tools a lease opened inside `openRun` lists, while the chat catalog is active. */
async function toolsListed(options: AgentRunOptions): Promise<{ name: string; description: string }[]> {
	const host = new McpToolHost();

	try {
		const lease = host.lease(options.tools, options.runTool, options.onEvent);

		const response = await fetch(lease.url, {
			method: 'POST',
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
		});

		lease.release();

		return listedSchema.parse(await response.json()).result.tools;
	} finally {
		host.stop();
	}
}

function tokens(input: number): TokenUsage {
	return {
		inputTokens: input,
		outputTokens: 1,
		totalTokens: input + 1,
		cachedInputTokens: null,
		cacheWriteInputTokens: null,
		reasoningOutputTokens: null
	};
}

test('text events stream into the reply and the run is given the chat tools', async () => {
	const marker = 'NOT_PREFETCHED_MARKER';
	const repo = await committed({ 'src/hidden.ts': `export const hidden = '${marker}';\n` });
	let listed: { name: string; description: string }[] = [];

	const { agent, runs } = scriptedAgent(
		async (run) => {
			run.options.onEvent({ type: 'reasoning', delta: '**Looking**\nThe question is small.', partId: 'r' });
			run.options.onEvent({ type: 'text', delta: 'Hello ', partId: 'a' });
			run.options.onEvent({ type: 'text', delta: 'x'.repeat(MAX_REPLY_CHARS), partId: 'a' });

			return { text: 'should not replace streamed text' };
		},
		async (options) => {
			listed = await toolsListed(options);
		}
	);

	const { job, reply, trail } = chatting(repo, 'How does auth work?');

	await answer(job, reply, trail, AbortSignal.timeout(10_000), () => undefined, agent);

	expect(reply.text.length).toBe(MAX_REPLY_CHARS);
	expect(reply.text.startsWith('Hello ')).toBe(true);
	expect(runs[0]?.options.system).toBe(recoderSystemPrompt(CHAT_TOOLS));
	expect(runs[0]?.options.tools).toEqual(CHAT_TOOLS.map((tool) => tool.name));
	expect(runs[0]?.promptOptions).toEqual({ tools: true, timeoutMs: CHAT_RUN_TIMEOUT_MS });
	expect(runs[0]?.promptText).toContain('How does auth work?');
	expect(runs[0]?.promptText).not.toContain(marker);
	expect(listed.map((tool) => tool.name)).toEqual(CHAT_TOOLS.map((tool) => tool.name));
	expect(listed.find((tool) => tool.name === 'read_file')?.description).toBe(CHAT_TOOLS[0]?.description);
	expect(runs[0]?.closed).toBe(true);

	const thought = reply.trail?.find((step) => step.kind === 'thought');

	expect(thought?.kind === 'thought' ? thought.title : '').toBe('Looking');
});

test('read_file is served from the git copy, with line numbers, a trail step and a citation', async () => {
	const repo = await committed({ 'src/a.ts': MARKER, 'README.md': 'shop\n' });
	let read = '';

	const { agent } = scriptedAgent(async (run) => {
		run.options.onEvent({ type: 'tool-call', name: 'read_file' });

		const outcome = await run.options.runTool('read_file', { path: 'src/a.ts' });

		read = outcome.text;
		run.options.onEvent({ type: 'tool-result', name: 'read_file', isError: outcome.isError });
		run.options.onEvent({ type: 'text', delta: 'See [a.ts:1](#cite:src/a.ts:1).', partId: 'a' });

		return { text: '' };
	});

	const { job, reply, trail } = chatting(repo, 'Show me src/a.ts');

	await answer(job, reply, trail, AbortSignal.timeout(20_000), () => undefined, agent);

	expect(read).toContain('1|export const MARKER = 1;');

	const step = reply.trail?.find((item) => item.kind === 'read' && item.files.some((file) => file.path === 'src/a.ts'));

	expect(step?.kind === 'read' ? step.status : '').toBe('done');
	expect(reply.citations?.[0]).toMatchObject({ path: 'src/a.ts', startLine: 1, snippet: 'export const MARKER = 1;' });
});

test('reads a model makes side by side each end done, and what it said before them becomes a note, not answer', async () => {
	const repo = await committed({ 'README.md': 'shop\n', 'AGENTS.md': 'rules\n' });

	const { agent } = scriptedAgent(async (run) => {
		run.options.onEvent({ type: 'text', delta: 'I will read both.', partId: 'a' });
		await Promise.all(['README.md', 'AGENTS.md'].map((path) => run.options.runTool('read_file', { path })));
		run.options.onEvent({ type: 'text', delta: 'Both are short.', partId: 'b' });

		return { text: '' };
	});

	const { job, reply, trail } = chatting(repo, 'Read the docs');

	await answer(job, reply, trail, AbortSignal.timeout(20_000), () => undefined, agent);

	expect(reply.trail?.filter((step) => step.kind === 'read').map((step) => step.status)).toEqual(['done', 'done']);
	expect(reply.trail?.find((step) => step.kind === 'note')).toMatchObject({ text: 'I will read both.' });
	expect(reply.text).toBe('Both are short.');
});

test('a path that escapes the git copy is refused', async () => {
	const outside = await chatTempDir('recoder-chat-secret-');

	await writeFile(join(outside, 'secret.txt'), SECRET);

	const repo = await committed({ 'src/a.ts': MARKER }, { 'src/linked.ts': join(outside, 'secret.txt') });
	const refused: string[] = [];

	const { agent } = scriptedAgent(async (run) => {
		for (const path of ['../secret', join(outside, 'secret.txt'), 'src/linked.ts']) {
			run.options.onEvent({ type: 'tool-call', name: 'read_file' });

			const outcome = await run.options.runTool('read_file', { path });

			refused.push(outcome.text);
			expect(outcome.isError).toBe(true);
			run.options.onEvent({ type: 'tool-result', name: 'read_file', isError: true });
		}

		const searched = await run.options.runTool('search', { query: SECRET });

		refused.push(searched.text);

		return { text: 'no' };
	});

	const { job, reply, trail } = chatting(repo, 'Read the secret');

	await answer(job, reply, trail, AbortSignal.timeout(20_000), () => undefined, agent);

	expect(refused.some((text) => text.includes('symbolic link'))).toBe(true);
	expect(refused.some((text) => text.includes('outside the repository'))).toBe(true);

	for (const text of refused) expect(text).not.toContain(SECRET);
});

test('search finds a literal and list_files lists one directory', async () => {
	const repo = await committed({ 'src/a.ts': MARKER, 'src/b.ts': 'export const other = 2;\n' });
	let found = '';
	let listed = '';

	const { agent } = scriptedAgent(async (run) => {
		found = (await run.options.runTool('search', { query: 'MARKER', prefix: 'src' })).text;
		listed = (await run.options.runTool('list_files', { prefix: 'src' })).text;

		return { text: 'done' };
	});

	const { job, reply, trail } = chatting(repo, 'Where is MARKER?');

	await answer(job, reply, trail, AbortSignal.timeout(20_000), () => undefined, agent);

	expect(found).toContain('src/a.ts');
	expect(found).toContain('MARKER');
	expect(listed).toContain('src/a.ts');
	expect(listed).toContain('src/b.ts');

	const search = reply.trail?.find((step) => step.kind === 'search');

	expect(search?.kind === 'search' ? search.query : '').toBe('MARKER');
	expect(search?.kind === 'search' ? search.status : '').toBe('done');
});

/** Runs `body` with a reviewer model set up and the local forge repo stored, then removes its reviews and the repo. */
async function withReviewer(body: (repo: Repo) => Promise<void>): Promise<void> {
	const previous = getStoredSettings();
	const { repo } = await localForgeFixture();

	setReviewOverrides({
		baseUrl: 'http://127.0.0.1:9/v1',
		apiKey: 'test',
		models: [{ id: 'test-model', label: 'Test', model: 'test-model' }],
		orchestratorModelId: 'test-model'
	});

	await db.repos.set(repo);

	try {
		await body(repo);
	} finally {
		setReviewOverrides(previous);

		const mine = (await db.reviews.list()).filter((item) => item.repoId === repo.id);

		for (const review of mine) await db.reviews.delete(review.id);

		await db.repos.delete(repo.id);
	}
}

test('a reply starts one review with its focus, and a second start_review beside it is refused', async () => {
	await withReviewer(async (repo) => {
		const outcomes: ToolOutcome[] = [];

		const { agent } = scriptedAgent(async (run) => {
			outcomes.push(
				...(await Promise.all([
					run.options.runTool('start_review', { pull: 7, focus: 'auth changes' }),
					run.options.runTool('start_review', { pull: 3 })
				]))
			);

			return { text: '' };
		});

		const { job, reply, trail } = chatting(repo, 'Look at the auth code.');

		await answer(job, reply, trail, AbortSignal.timeout(20_000), () => undefined, agent);

		const reviews = (await db.reviews.list()).filter((item) => item.repoId === repo.id);

		expect(outcomes.map((outcome) => outcome.isError)).toEqual([false, true]);
		expect(reviews.map((review) => review.prNumber)).toEqual([7]);
		expect(reviews[0]?.startedBy).toBe('ada');
		expect(await reviewInstructions(reviews[0]?.id ?? '')).toContain('auth changes');
		expect(reply.review?.prNumber).toBe(7);
		expect(reply.text).toContain('Started a review of #7.');
	});
});

test('start_review for a pull request the forge does not have queues nothing and leaves the reply to answer', async () => {
	await withReviewer(async (repo) => {
		let outcome: ToolOutcome | undefined;

		const { agent } = scriptedAgent(async (run) => {
			outcome = await run.options.runTool('start_review', { pull: 99 });

			return { text: 'There is no #99.' };
		});

		const { job, reply, trail } = chatting(repo, 'What changed lately?');

		await answer(job, reply, trail, AbortSignal.timeout(20_000), () => undefined, agent);

		expect(outcome?.isError).toBe(true);
		expect((await db.reviews.list()).filter((item) => item.repoId === repo.id)).toEqual([]);
		expect(reply.failure).toBeUndefined();
		expect(reply.text).toBe('There is no #99.');
	});
});

test('stopping the reply aborts and closes the run', async () => {
	let started: (() => void) | undefined;

	const opened = new Promise<void>((resolve) => {
		started = resolve;
	});

	const { agent, runs } = scriptedAgent(
		(run) =>
			new Promise((_resolve, reject) => {
				started?.();

				const abort = () => reject(new LlmError(0, 'cancelled'));

				if (run.options.signal.aborted) abort();
				else run.options.signal.addEventListener('abort', abort, { once: true });
			})
	);

	const controller = new AbortController();
	const { job, reply, trail } = chatting(bareRepo(), 'Keep going');
	const pending = answer(job, reply, trail, controller.signal, () => undefined, agent);

	await opened;
	controller.abort();

	await expect(pending).rejects.toMatchObject({ status: 0, message: 'cancelled' });
	expect(runs[0]?.aborted).toBe(true);
	expect(runs[0]?.closed).toBe(true);
});

test('the 25th tool call is refused and tells the model to answer', async () => {
	const outcomes: { text: string; isError: boolean }[] = [];

	const { agent } = scriptedAgent(async (run) => {
		for (let call = 0; call < MAX_CHAT_TOOL_CALLS + 1; call++) {
			outcomes.push(await run.options.runTool('read_file', { path: '../nope' }));
		}

		return { text: 'enough' };
	});

	const { job, reply, trail } = chatting(bareRepo(), 'Read everything');

	await answer(job, reply, trail, AbortSignal.timeout(10_000), () => undefined, agent);

	expect(outcomes[MAX_CHAT_TOOL_CALLS - 1]?.text).toContain('outside the repository');
	expect(outcomes[MAX_CHAT_TOOL_CALLS - 1]?.text).not.toContain('Answer');
	expect(outcomes[MAX_CHAT_TOOL_CALLS]?.isError).toBe(true);
	expect(outcomes[MAX_CHAT_TOOL_CALLS]?.text).toContain('Answer');
	expect(outcomes[MAX_CHAT_TOOL_CALLS]?.text).toContain(String(MAX_CHAT_TOOL_CALLS));
});

test('each model step records its session and prompt index in the chat model_calls rows', async () => {
	const { agent } = scriptedAgent(async (run) => {
		run.options.onEvent({ type: 'prompt-start', session: 'ses_chat', turn: 1 });
		run.options.onEvent({ type: 'step-start', step: 'a' });
		run.options.onEvent({ type: 'usage', usage: tokens(3), step: 'a' });
		run.options.onEvent({ type: 'step-start', step: 'b' });
		run.options.onEvent({ type: 'usage', usage: tokens(5), step: 'b' });

		return { text: 'done' };
	});

	const { job, reply, trail, chat } = chatting(bareRepo(), 'Hello');

	await db.repoChats.set(chat);

	try {
		await answer(job, reply, trail, AbortSignal.timeout(10_000), () => undefined, agent);

		const rows = (await modelCalls.list()).filter((row) => row.ownerId === chat.id);

		expect(rows.map((row) => row.usage.inputTokens)).toEqual([3, 5]);

		expect(rows.map(({ session, turn }) => ({ session, turn }))).toEqual([
			{ session: 'ses_chat', turn: 1 },
			{ session: 'ses_chat', turn: 1 }
		]);
	} finally {
		await db.repoChats.delete(chat.id);
	}
});
