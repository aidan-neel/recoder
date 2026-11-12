import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationLedger } from '../../../src/agents/antigravity/antigravity-conversations';
import { hasProtoSummary, seedConversationSummary, summaryRowCount } from '../../helpers/fake-antigravity';

test('a conversation that a running agy writes back is deleted again when the last process ends', async () => {
	const home = await mkdtemp(join(tmpdir(), 'fake-agy-home-'));
	const ledger = new ConversationLedger({ HOME: home }, new Set());
	const conversationId = crypto.randomUUID();
	const stop = new AbortController();

	seedConversationSummary(home, conversationId, 'The first prompt of a review');
	ledger.track(conversationId);

	const stillRunning = ledger.stream({
		argv: ['sleep', '600'],
		cwd: home,
		env: { PATH: process.env.PATH ?? '' },
		stdin: null,
		signal: stop.signal,
		maxOutputBytes: 1024,
		onOutput: () => {},
		name: 'agy'
	});

	await ledger.delete(conversationId);
	seedConversationSummary(home, conversationId, 'Written back by the process still running');
	stop.abort();

	expect(
		await stillRunning.then(
			() => 'ended',
			() => 'stopped'
		)
	).toBe('stopped');

	expect(summaryRowCount(home, conversationId)).toBe(0);
	expect(hasProtoSummary(home, conversationId)).toBe(false);
});
