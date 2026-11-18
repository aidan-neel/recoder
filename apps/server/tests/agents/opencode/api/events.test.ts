import { expect, test } from 'bun:test';
import type { TokenUsage } from '@recoder/shared';
import { V1Api } from '../../../../src/agents/opencode/api/v1';
import { V2Api } from '../../../../src/agents/opencode/api/v2';
import type { SessionHandlers } from '../../../../src/agents/opencode/opencode-events';
import type { OpenCodeServer } from '../../../../src/agents/opencode/opencode-server';

const tokens = { input: 100, output: 20, reasoning: 5, cache: { read: 40, write: 10 } };

const usage: TokenUsage = {
	inputTokens: 150,
	outputTokens: 25,
	totalTokens: 175,
	cachedInputTokens: 40,
	cacheWriteInputTokens: 10,
	reasoningOutputTokens: 5
};

/** What a router told its handlers: `start x` and `finish x <usage>` for the step with message id `x`. */
function record(): { handlers: SessionHandlers; seen: unknown[] } {
	const seen: unknown[] = [];

	return {
		seen,
		handlers: {
			onStepStart: (step) => seen.push(['start', step]),
			onStepFinish: (finished, step) => seen.push(['finish', step, finished])
		}
	};
}

const server = {} as OpenCodeServer;

test('OpenCode 1 step events carry their session on the part alone, and still count the step and its usage', () => {
	const { handlers, seen } = record();
	const route = new V1Api(server).events.router(handlers);

	const part = (type: string, extra: object = {}) => ({
		type: 'message.part.updated',
		properties: { part: { id: `p_${type}`, sessionID: 'ses_1', messageID: 'msg_1', type, ...extra } }
	});

	route(part('step-start'), 'ses_1');
	route(part('step-finish', { tokens }), 'ses_1');
	route(part('step-finish', { tokens }), 'ses_1');

	expect(seen).toEqual([
		['start', 'msg_1'],
		['finish', 'msg_1', usage]
	]);
});

test('OpenCode 1 steps of another session are ignored', () => {
	const { handlers, seen } = record();
	const route = new V1Api(server).events.router(handlers);

	route(
		{
			type: 'message.part.updated',
			properties: { part: { id: 'p', sessionID: 'other', messageID: 'm', type: 'step-start' } }
		},
		'ses_1'
	);

	expect(seen).toEqual([]);
});

test('OpenCode 2 step events report each step once with its message id and usage', () => {
	const { handlers, seen } = record();
	const route = new V2Api(server).events.router(handlers);

	const event = (type: string, data: object = {}) => ({
		type,
		data: { sessionID: 'ses_1', assistantMessageID: 'msg_1', ...data }
	});

	route(event('session.step.started'), 'ses_1');
	route(event('session.step.started'), 'ses_1');
	route(event('session.step.ended', { tokens }), 'ses_1');
	route(event('session.step.ended', { tokens }), 'ses_1');

	expect(seen).toEqual([
		['start', 'msg_1'],
		['finish', 'msg_1', usage]
	]);
});
