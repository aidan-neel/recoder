import { expect, spyOn, test } from 'bun:test';
import type { AgentEvent } from '../../../src/agents/contract';
import type { OpenCodeAgent } from '../../../src/agents/opencode/opencode';
import { ChatConversation } from '../../../src/models/llm/conversation';
import { withUsageMetrics } from '../../../src/models/metrics';
import { db } from '../../../src/store';
import { useFakeOpenCode } from '../../helpers/fake-opencode';
import { fakeOpenCodeV2Script, useFakeOpenCodeV2 } from '../../helpers/fake-opencode-v2';
import { ask, calls } from '../../helpers/opencode-chat';
import { testReview } from '../../helpers/review';
import { useTempStore } from '../../helpers/temp-store';

const store = useTempStore('recoder-cache-root-');
const start = useFakeOpenCodeV2();
const startV1 = useFakeOpenCode();

const startFailing = useFakeOpenCode(
	fakeOpenCodeV2Script().replace(
		"const id = 'ses_' + ++made;",
		"if (++made === 1) return new Response('root failed', { status: 500 }); const id = 'ses_' + made;"
	)
);

async function review(): Promise<string> {
	const value = await db.reviews.set(testReview({ repoId: 'missing' }));

	store.track(value.id);

	return value.id;
}

function open(target: OpenCodeAgent, onEvent: (event: AgentEvent) => void = () => {}) {
	return target.openRun({
		model: 'openai/m',
		system: 'Review.',
		tools: [],
		runTool: async () => ({ text: '', isError: false }),
		onEvent,
		signal: new AbortController().signal
	});
}

async function creations(target: OpenCodeAgent) {
	return (await calls(target)).filter((call) => call.method === 'POST' && call.path === '/api/session');
}

test('two sequential runs share one unprompted deny-all review root which is deleted at completion', async () => {
	const target = await start();

	await withUsageMetrics(await review(), 'pipeline', async () => {
		await (await open(target)).close();
		await (await open(target)).close();

		expect((await calls(target)).filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual([
			'/api/session/ses_2',
			'/api/session/ses_3'
		]);
	});

	const log = await creations(target);

	expect(log).toHaveLength(3);
	expect(log[0].body).toMatchObject({ permissions: [{ action: '*', resource: '*', effect: 'deny' }] });
	expect(log.map((call) => call.body?.parentID)).toEqual([undefined, 'ses_1', 'ses_1']);
	expect((await calls(target)).at(-1)).toMatchObject({ method: 'DELETE', path: '/api/session/ses_1' });
	expect((await calls(target)).some((call) => call.path.endsWith('/prompt'))).toBe(false);
});

test('concurrent opens share the same root creation promise', async () => {
	const target = await start();

	await withUsageMetrics(await review(), 'pipeline', async () => {
		const runs = await Promise.all([open(target), open(target), open(target)]);

		await Promise.all(runs.map((run) => run.close()));
	});

	expect((await creations(target)).map((call) => call.body?.parentID)).toEqual([undefined, 'ses_1', 'ses_1', 'ses_1']);
});

test('different reviews use different roots', async () => {
	const target = await start();

	await Promise.all(
		[await review(), await review()].map((id) =>
			withUsageMetrics(id, 'pipeline', async () => {
				await (await open(target)).close();
			})
		)
	);

	const log = await creations(target);
	const parents = log.flatMap((call) => (call.body?.parentID ? [call.body.parentID] : []));

	expect(log).toHaveLength(4);
	expect(new Set(parents).size).toBe(2);
});

test('a run outside a review keeps its parentless session', async () => {
	const target = await start();

	await (await open(target)).close();

	expect((await creations(target)).map((call) => call.body?.parentID)).toEqual([undefined]);
});

test('cancellation deletes the root after the review work settles', async () => {
	const target = await start();

	await expect(
		withUsageMetrics(await review(), 'pipeline', async () => {
			await (await open(target)).close();
			throw new Error('cancelled');
		})
	).rejects.toThrow('cancelled');

	expect((await calls(target)).at(-1)).toMatchObject({ method: 'DELETE', path: '/api/session/ses_1' });
});

test('root creation failure falls back to parentless runs and logs once', async () => {
	const target = await startFailing();
	const warning = spyOn(console, 'warn').mockImplementation(() => {});

	try {
		await withUsageMetrics(await review(), 'pipeline', async () => {
			await (await open(target)).close();
			await (await open(target)).close();
		});

		expect((await creations(target)).map((call) => call.body?.parentID)).toEqual([undefined, undefined, undefined]);
		expect(warning).toHaveBeenCalledTimes(1);
	} finally {
		warning.mockRestore();
	}
});

test('prompts report their session and one-based index even when the provider fails', async () => {
	const target = await start();
	const events: AgentEvent[] = [];
	const run = await open(target, (event) => events.push(event));

	try {
		await run.prompt('hi', { tools: false, timeoutMs: 5000 });
		await run.prompt('denied', { tools: false, timeoutMs: 5000 });

		expect(events.filter((event) => event.type === 'prompt-start')).toMatchObject([
			{ type: 'prompt-start', session: 'ses_1', turn: 1 },
			{ type: 'prompt-start', session: 'ses_1', turn: 2 }
		]);
	} finally {
		await run.close();
	}
});

test('OpenCode 1 sessions also receive the shared root parent identifier', async () => {
	const target = await startV1();

	await withUsageMetrics(await review(), 'pipeline', async () => {
		await (await open(target)).close();
		await (await open(target)).close();
	});

	const log = (await calls(target)).filter((call) => call.method === 'POST' && call.path === '/session');

	expect(log.map((call) => call.body?.parentID)).toEqual([undefined, 'ses_1', 'ses_1']);
	expect((await calls(target)).at(-1)).toMatchObject({ method: 'DELETE', path: '/session/ses_1' });
});

test('a retained conversation starts a fresh child after its previous review root was deleted', async () => {
	const target = await start();
	const id = await review();
	const conversation = new ChatConversation();
	const reply = await withUsageMetrics(id, 'pipeline', () => target.complete(ask('hi', { conversation })));

	await withUsageMetrics(id, 'discussion', () =>
		target.complete(
			ask('', {
				conversation,
				messages: [
					{ role: 'user', content: 'hi' },
					{ role: 'assistant', content: reply },
					{ role: 'user', content: 'next' }
				]
			})
		)
	);

	expect((await creations(target)).map((call) => call.body?.parentID)).toEqual([
		undefined,
		'ses_1',
		undefined,
		'ses_3'
	]);

	await conversation.close();
});

test('a crashed OpenCode server is restarted for cleanup of the persisted review root', async () => {
	const target = await start();

	await withUsageMetrics(await review(), 'pipeline', async () => {
		const run = await open(target);

		try {
			expect((await run.prompt('crash', { tools: false, timeoutMs: 5000 })).error).toBeDefined();
		} finally {
			await run.close();
		}
	});

	expect(await calls(target)).toContainEqual(expect.objectContaining({ method: 'DELETE', path: '/api/session/ses_1' }));
});
