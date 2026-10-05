import { expect, test } from 'bun:test';
import type { ReviewChatMessage } from '@recoder/shared';
import { latestOutputRate } from '../../src/lib/review/output-rate';

function reply(id: string, at: string, tokensPerSecond: number, forwardedFrom?: string): ReviewChatMessage {
	return {
		id,
		assignmentId: 'orchestrator',
		from: 'assistant',
		text: 'ok',
		at,
		status: 'done',
		forwardedFrom,
		outputRate: { tokensPerSecond, estimated: false }
	};
}

test('a reply mirrored in from another agent never sets the speed, even when it is newest', () => {
	const messages = [
		reply('own', '2026-10-03T10:00:00.000Z', 80),
		reply('mirrored', '2026-10-03T10:00:05.000Z', 300, 'reviewer-1')
	];

	expect(latestOutputRate(messages, [])).toEqual({ id: 'own', rate: { tokensPerSecond: 80, estimated: false } });
});
