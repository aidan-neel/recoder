import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
	fakeAntigravityCalls,
	hasProtoSummary,
	savedConversationPaths,
	seedConversationSummary,
	summaryRowCount
} from '../../helpers/fake-antigravity';
import { allGone, spawnedPids } from '../../helpers/fake-claude';
import { PROMPT, breakSummariesSnapshot, openRun, warningsFrom } from './antigravity-fixture';

/** A run whose prompt is still in flight, read as far as the line that names its conversation. */
async function openInFlightRun(home?: string) {
	let markInitRead = () => {};

	const initRead = new Promise<void>((resolve) => {
		markInitRead = resolve;
	});

	const opened = await openRun('spawn', {
		home,
		onEvent: (event) => {
			if (event.type === 'reasoning') markInitRead();
		}
	});

	const pending = opened.run.prompt('Review it.', PROMPT);
	const [, pids] = await Promise.all([initRead, spawnedPids(opened.log)]);
	const [logged] = await fakeAntigravityCalls(opened.log);

	if (!logged) throw new Error('the fake CLI logged no call');

	return { ...opened, pending, pids, logged };
}

describe('Antigravity conversation cleanup', () => {
	test('closing a run deletes its config, lock and summary rows on succeeded and failed prompts while keeping others', async () => {
		const succeeded = await openRun('answer');
		const failed = await openRun('crash');
		const otherConversationId = crypto.randomUUID();

		seedConversationSummary(succeeded.home, otherConversationId, 'Keep my personal chat');

		await succeeded.run.prompt('Review it.', PROMPT);

		const failedReply = await failed.run.prompt('Review it.', PROMPT);

		expect(failedReply.error?.message).toContain('boom');

		const [okCall] = await fakeAntigravityCalls(succeeded.log);
		const [badCall] = await fakeAntigravityCalls(failed.log);

		expect(okCall).toBeDefined();
		expect(badCall).toBeDefined();
		if (!okCall || !badCall) return;

		expect(summaryRowCount(succeeded.home, okCall.conversationId)).toBe(3);
		expect(summaryRowCount(failed.home, badCall.conversationId)).toBe(3);
		expect(hasProtoSummary(succeeded.home, okCall.conversationId)).toBe(true);

		for (const target of savedConversationPaths(succeeded.home, okCall.conversationId)) {
			expect(existsSync(target)).toBe(true);
		}

		for (const target of savedConversationPaths(failed.home, badCall.conversationId)) {
			expect(existsSync(target)).toBe(true);
		}

		await Promise.all([succeeded.run.close(), failed.run.close()]);

		expect(existsSync(dirname(okCall.cwd))).toBe(false);
		expect(existsSync(dirname(badCall.cwd))).toBe(false);
		expect(summaryRowCount(succeeded.home, okCall.conversationId)).toBe(0);
		expect(summaryRowCount(failed.home, badCall.conversationId)).toBe(0);
		expect(summaryRowCount(succeeded.home, otherConversationId)).toBe(3);
		expect(hasProtoSummary(succeeded.home, okCall.conversationId)).toBe(false);
		expect(hasProtoSummary(failed.home, badCall.conversationId)).toBe(false);
		expect(hasProtoSummary(succeeded.home, otherConversationId)).toBe(true);

		for (const target of savedConversationPaths(succeeded.home, okCall.conversationId)) {
			expect(existsSync(target)).toBe(false);
		}

		for (const target of savedConversationPaths(failed.home, badCall.conversationId)) {
			expect(existsSync(target)).toBe(false);
		}
	});

	test('closing one run keeps another concurrent run’s saved conversation and summary rows in the same home', async () => {
		const first = await openRun('answer');
		const second = await openRun('answer', { home: first.home });

		await Promise.all([first.run.prompt('First.', PROMPT), second.run.prompt('Second.', PROMPT)]);
		await first.run.close();

		const [firstCall] = await fakeAntigravityCalls(first.log);
		const [secondCall] = await fakeAntigravityCalls(second.log);

		expect(firstCall).toBeDefined();
		expect(secondCall).toBeDefined();
		if (!firstCall || !secondCall) return;

		const keptPaths = savedConversationPaths(second.home, secondCall.conversationId).every((target) =>
			existsSync(target)
		);

		const keptSummaries = summaryRowCount(second.home, secondCall.conversationId);
		const removedSummaries = summaryRowCount(first.home, firstCall.conversationId);

		await second.run.close();

		expect(keptPaths).toBe(true);
		expect(keptSummaries).toBe(3);
		expect(removedSummaries).toBe(0);
		expect(summaryRowCount(second.home, secondCall.conversationId)).toBe(0);
	});

	test('stopping the agent after init sweeps an in-flight run’s conversation files, lock and summary rows', async () => {
		const opened = await openInFlightRun();

		expect(summaryRowCount(opened.home, opened.logged.conversationId)).toBe(3);

		opened.agent.stop();

		expect(existsSync(dirname(opened.logged.cwd))).toBe(false);
		expect(summaryRowCount(opened.home, opened.logged.conversationId)).toBe(0);

		for (const target of savedConversationPaths(opened.home, opened.logged.conversationId)) {
			expect(existsSync(target)).toBe(false);
		}

		await opened.pending;
		await opened.run.close();
		expect(await allGone(opened.pids)).toBe(true);
	});

	test('stopping the agent with an unreadable history snapshot does not throw and still deletes the conversation’s files', async () => {
		const home = await mkdtemp(join(tmpdir(), 'fake-agy-home-'));

		breakSummariesSnapshot(home);

		const opened = await openInFlightRun(home);
		const warned = await warningsFrom(() => opened.agent.stop());

		expect(warned).toContain(opened.logged.conversationId);

		for (const target of savedConversationPaths(home, opened.logged.conversationId)) {
			expect(existsSync(target)).toBe(false);
		}

		await opened.pending;
		await warningsFrom(() => opened.run.close());
		expect(await allGone(opened.pids)).toBe(true);
	});

	test('closing a run resolves when its summary rows cannot be deleted, and a later close deletes them', async () => {
		const opened = await openRun('answer');

		await opened.run.prompt('Review it.', PROMPT);

		const [logged] = await fakeAntigravityCalls(opened.log);

		expect(logged).toBeDefined();
		if (!logged) return;

		const summariesDb = join(opened.home, '.gemini', 'antigravity-cli', 'conversation_summaries.db');

		chmodSync(summariesDb, 0o444);

		try {
			const warned = await warningsFrom(() => opened.run.close());

			expect(warned).toContain(logged.conversationId);
			expect(summaryRowCount(opened.home, logged.conversationId)).toBe(3);
		} finally {
			for (const suffix of ['', '-wal', '-shm']) {
				const file = `${summariesDb}${suffix}`;

				if (existsSync(file)) chmodSync(file, 0o600);
			}
		}

		await opened.run.close();
		expect(summaryRowCount(opened.home, logged.conversationId)).toBe(0);
	});
});
