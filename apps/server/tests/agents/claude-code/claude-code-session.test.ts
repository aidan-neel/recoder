import { describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeAgent } from '../../../src/agents/claude-code/claude-code';
import { ChatConversation } from '../../../src/models/llm/conversation';
import type { ChatMessage, ChatOptions } from '../../../src/models/llm/types';
import { fakeClaude, fakeClaudeLog } from '../../helpers/fake-claude';

const SYSTEM: ChatMessage = { role: 'system', content: 'Review the diff.' };

function call(conversation: ChatConversation, turns: ChatMessage[]): ChatOptions {
	return {
		provider: 'claude-code',
		baseUrl: '',
		apiKey: '',
		model: 'claude-haiku-5-5',
		reasoningEffort: 'medium',
		messages: [SYSTEM, ...turns],
		conversation
	};
}

/** The fake CLI's log of its last call, and the session ids it was given. */
async function lastCall(log: string): Promise<{ text: string; session: string; resumed: string | null }> {
	const text = await readFile(log, 'utf8');

	return {
		text,
		session: text.match(/\[--session-id\] \[([^\]]+)\]/)?.[1] ?? '',
		resumed: text.match(/\[--resume\] \[([^\]]+)\]/)?.[1] ?? null
	};
}

/** Every session the fake CLI's config dir still holds. */
async function savedSessions(config: string): Promise<string[]> {
	const projects = join(config, 'projects');
	const folders = await readdir(projects).catch(() => []);
	const files = await Promise.all(folders.map((folder) => readdir(join(projects, folder))));

	return files.flat().map((name) => name.replace(/\.jsonl$/, ''));
}

async function setup(): Promise<{ log: string; config: string; env: Record<string, string> }> {
	const log = await fakeClaudeLog();
	const config = await mkdtemp(join(tmpdir(), 'fake-claude-config-'));

	return { log, config, env: await fakeClaude({ FAKE_CLAUDE_LOG: log, CLAUDE_CONFIG_DIR: config }) };
}

describe('Claude Code sessions', () => {
	test('a later call resumes the kept session with only the new turns, and close deletes it', async () => {
		const { log, config, env } = await setup();
		const agent = new ClaudeCodeAgent(env);
		const conversation = new ChatConversation();
		const first: ChatMessage[] = [{ role: 'user', content: 'diff one' }];

		await agent.complete(call(conversation, first));

		const opened = await lastCall(log);

		await agent.complete(
			call(conversation, [...first, { role: 'assistant', content: 'Hi there' }, { role: 'user', content: 'and two' }])
		);

		const resumed = await lastCall(log);

		expect(opened.resumed).toBeNull();
		expect(resumed.resumed).toBe(opened.session);
		expect(resumed.text).toContain('[--fork-session]');
		expect(resumed.text).toContain('prompt: and two\n');
		expect(await savedSessions(config)).toEqual([resumed.session]);

		await conversation.close();

		expect(await savedSessions(config)).toEqual([]);
	});

	test("a failed call's fork is deleted and the next call resumes the last good session", async () => {
		const { log, config, env } = await setup();
		const conversation = new ChatConversation();
		const first: ChatMessage[] = [{ role: 'user', content: 'diff one' }];

		const second: ChatMessage[] = [
			...first,
			{ role: 'assistant', content: 'Hi there' },
			{ role: 'user', content: 'two' }
		];

		await new ClaudeCodeAgent(env).complete(call(conversation, first));

		const good = (await lastCall(log)).session;

		const failed = await new ClaudeCodeAgent({ ...env, FAKE_CLAUDE_MODE: 'crash' })
			.complete(call(conversation, second))
			.catch((e: unknown) => e);

		expect(failed).toBeInstanceOf(Error);
		expect(await savedSessions(config)).toEqual([good]);

		await new ClaudeCodeAgent(env).complete(call(conversation, second));

		expect((await lastCall(log)).resumed).toBe(good);
	});
});
