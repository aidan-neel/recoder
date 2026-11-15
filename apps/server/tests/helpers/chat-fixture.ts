import type { Repo, RepoChatMessage } from '@recoder/shared';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ModelConfig } from '../../src/models/models';
import type { ReplyJob } from '../../src/repo-chat/chat-reply';
import type { StoredRepoChat } from '../../src/repo-chat/chat-record';
import { TrailRecorder } from '../../src/repo-chat/chat-trail';
import { commitAll, git, writeTree } from './git';

/** The temporary repositories \`committed\` made, removed by \`removeChatRepos\`. */
const roots: string[] = [];

/** A new temporary directory that \`removeChatRepos\` deletes with the repositories. */
export async function chatTempDir(prefix: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), prefix));

	roots.push(root);

	return root;
}

/** Deletes every repository \`committed\` made; run it after each test. */
export async function removeChatRepos(): Promise<void> {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

function modelConfig(provider: ModelConfig['provider']): ModelConfig {
	return { provider, baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'test', model: 'chat-model', contextWindow: 128_000 };
}

/** A repository chat with one question and its streaming reply, ready for `answer`. */
export function chatting(repo: Repo, text: string, provider: ModelConfig['provider'] = 'claude-code') {
	const at = new Date().toISOString();
	const user: RepoChatMessage = { id: crypto.randomUUID(), from: 'user', text, at, status: 'done' };

	const reply: RepoChatMessage = {
		id: crypto.randomUUID(),
		from: 'assistant',
		text: '',
		at,
		status: 'streaming',
		model: 'chat-model'
	};

	const chat: StoredRepoChat = {
		id: crypto.randomUUID(),
		repoId: repo.id,
		title: 'Chat',
		startedBy: 'ada',
		createdAt: at,
		updatedAt: at,
		messages: [user, reply]
	};

	const job: ReplyJob = { chat, repo, turn: { user, reply }, config: modelConfig(provider), skills: [] };

	return { job, reply, trail: new TrailRecorder(reply, () => undefined), chat };
}

/** A local git repository holding `files` (and symlinks `links`) in one commit. */
export async function committed(files: Record<string, string>, links: Record<string, string> = {}): Promise<Repo> {
	const root = await chatTempDir('recoder-chat-agent-');

	git(root, ['init', '-q', '-b', 'main']);

	await writeTree(root, files, links);
	commitAll(root, 'files');

	const at = new Date().toISOString();

	return {
		id: crypto.randomUUID(),
		name: 'acme/shop',
		url: pathToFileURL(root).href,
		provider: 'local',
		defaultBranch: 'main',
		createdAt: at,
		updatedAt: at
	};
}
