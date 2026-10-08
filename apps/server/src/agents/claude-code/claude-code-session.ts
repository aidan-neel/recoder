import { readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { addedTurns, promptText, type ChatConversation, type HeldTranscript } from '../../models/llm/conversation';
import type { ChatOptions } from '../../models/llm/types';

type Env = Record<string, string | undefined>;

/** The session a conversation keeps between calls: the last good call's session, which holds the whole transcript. */
interface KeptSession extends HeldTranscript {
	id: string;
}

const kept = new WeakMap<ChatConversation, KeptSession>();

/** One call's place in a conversation: the session flags and stdin to run with, and how to settle it. */
export interface SessionCall {
	args: string[];
	prompt: string;
	/** The call replied: its session now holds the conversation, so the one it forked from is deleted. */
	commit(reply: string): void;
	/** The call failed: its session is deleted, so a retry forks the last good one again. */
	fail(): void;
}

/** What a call asks of the CLI, beyond its turns: the settings a kept session must match. */
export interface SessionRequest {
	conversation: ChatConversation | undefined;
	model: string;
	system: string;
	/** The effort flags, so a call at another effort starts its own session. */
	variant: string;
	turns: ChatOptions['messages'];
}

/**
 * The transcripts the CLI saves for the sessions Recoder starts. Each lives in the CLI's config dir, under a
 * folder named for the working directory: every non-alphanumeric character of the path becomes `-`. Nothing but
 * Recoder runs the CLI in that directory, so every file in the folder is Recoder's. The files hold the review's
 * prompts, and a fork copies its parent's whole transcript, so each is deleted once no call will resume it.
 */
class SessionFiles {
	readonly folder: string;
	private readonly config: string;

	constructor(env: Env, cwd: string) {
		this.config = env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), '.claude');
		this.folder = join(this.config, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
	}

	/** Best effort: delete one session's transcript and the file history the CLI keeps beside it. */
	remove(id: string): void {
		rmSync(join(this.folder, `${id}.jsonl`), { force: true });
		rmSync(join(this.config, 'file-history', id), { recursive: true, force: true });
	}

	/** Delete every session in the folder, as a crash or a kill leaves them. */
	sweep(): void {
		try {
			for (const name of readdirSync(this.folder)) if (name.endsWith('.jsonl')) this.remove(name.slice(0, -6));
		} catch {
			return;
		}
	}
}

/** The session folders this process has used, each swept once before its first session. */
const opened = new Map<string, SessionFiles>();

function sessionFiles(env: Env, cwd: string): SessionFiles {
	const files = new SessionFiles(env, cwd);
	const known = opened.get(files.folder);

	if (known) return known;

	files.sweep();
	opened.set(files.folder, files);

	return files;
}

/** Delete every session this process's folders still hold; synchronous, for exit. */
export function sweepSessions(): void {
	for (const files of opened.values()) files.sweep();
}

/**
 * The session to run this call in. A conversation keeps one session and sends it only the turns added since its
 * last reply, by resuming it as a fork with a new id: the provider then reads the earlier turns from its cache,
 * where a whole transcript sent as one prompt is written to the cache again on every call. Forking leaves the
 * last good session as it was, so a failed call is dropped by deleting its fork. A call without a conversation
 * saves no session at all.
 */
export function sessionCall(request: SessionRequest, env: Env, cwd: string): SessionCall {
	const { conversation } = request;

	if (!conversation)
		return { args: ['--no-session-persistence'], prompt: promptText(null, request.turns), commit() {}, fail() {} };

	const files = sessionFiles(env, cwd);
	const held = kept.get(conversation);
	const added = held ? addedTurns(held, request) : null;
	const id = crypto.randomUUID();

	if (!held)
		conversation.onClose(async () => {
			const last = kept.get(conversation);

			kept.delete(conversation);
			if (last) files.remove(last.id);
		});

	return {
		args: held && added ? ['--resume', held.id, '--fork-session', '--session-id', id] : ['--session-id', id],
		prompt: promptText(added, request.turns),
		commit(reply) {
			const previous = kept.get(conversation);
			const { model, system, variant } = request;

			kept.set(conversation, { id, model, system, variant, turns: request.turns.length + 1, reply });
			if (previous) files.remove(previous.id);
		},
		fail: () => files.remove(id)
	};
}
