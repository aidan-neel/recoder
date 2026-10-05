import type { ChatConversation } from '../../models/llm/conversation';
import type { ChatMessage } from '../../models/llm/types';
import type { OpenCodeServer } from './opencode-server';

/** Where a session lives: the managed server and the directory that scopes it. */
export type SessionScope = Pick<TurnRequest, 'server' | 'directory'>;

/** The session a conversation keeps between calls, and what OpenCode already holds of it. */
interface KeptSession {
	id: string;
	model: string;
	system: string;
	variant: string | undefined;
	/** How many turns of the transcript the session holds, the last reply included. */
	turns: number;
	reply: string;
	/** The last message of the last good call; a failed call's messages come after it. */
	lastMessageId: string | null;
}

const kept = new WeakMap<ChatConversation, KeptSession>();

/** One call's place in a session: what to send, and how to settle it. */
export interface SessionTurn {
	session: string;
	text: string;
	/** The call replied: remember what the session now holds. */
	commit(reply: string, messageId: string | undefined): void;
	/** The call is over. A throwaway session is deleted; a kept one drops a failed call's messages. */
	end(ok: boolean, aborted: boolean): Promise<void>;
}

/** The request this call makes, as OpenCode takes it. */
interface TurnRequest {
	server: OpenCodeServer;
	directory: string;
	model: string;
	system: string;
	variant?: string;
	turns: ChatMessage[];
	conversation?: ChatConversation;
	signal: AbortSignal;
}

/** OpenCode takes one user turn per message, so a transcript it does not hold yet is sent as one text. */
function flatten(turns: ChatMessage[]): string {
	return turns.length === 1
		? turns[0].content
		: turns.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}:\n${m.content}`).join('\n\n');
}

/** The turns added since the session's last reply, when the transcript only grew by user turns after it. */
function newTurns(session: KeptSession, request: TurnRequest): ChatMessage[] | null {
	const { turns } = request;
	const added = turns.slice(session.turns);
	const last = turns[session.turns - 1];

	const continues =
		session.model === request.model &&
		session.system === request.system &&
		session.variant === request.variant &&
		added.length > 0 &&
		last?.role === 'assistant' &&
		last.content === session.reply &&
		added.every((m) => m.role === 'user');

	return continues ? added : null;
}

/** A session that may use none of OpenCode's own tools; `allow` names the patterns it may call. */
export async function createSession(
	request: SessionScope & Pick<TurnRequest, 'model' | 'system' | 'variant'> & { signal: AbortSignal },
	allow: string[] = []
): Promise<string> {
	const api = await request.server.api();

	return api.createSession({
		directory: request.directory,
		model: request.model,
		system: request.system,
		variant: request.variant,
		allow,
		signal: request.signal
	});
}

/** Best effort: stop the model when the call was aborted, so nothing keeps running in OpenCode. */
export async function abortSession(request: SessionScope, id: string, aborted: boolean): Promise<void> {
	if (!aborted) return;

	await (await request.server.api()).abort(request.directory, id).catch(() => {});
}

/** Best effort: drop the session so nothing piles up in OpenCode. */
export async function deleteSession(request: SessionScope, id: string): Promise<void> {
	await (await request.server.api()).deleteSession(request.directory, id).catch(() => {});
}

/**
 * Remove a failed call's messages, so the retry sends the same turn to the
 * same session and the provider's cache still matches. A version that cannot
 * throws, and the caller starts a new session.
 */
async function rollBack(request: TurnRequest, session: KeptSession): Promise<void> {
	const api = await request.server.api();

	await api.rollBack(request.directory, session.id, session.lastMessageId, session.turns > 0);
}

/** A session made for this call alone and deleted after it. */
async function throwawayTurn(request: TurnRequest): Promise<SessionTurn> {
	const session = await createSession(request);

	return {
		session,
		text: flatten(request.turns),
		commit: () => {},
		end: async (_ok, aborted) => {
			await abortSession(request, session, aborted);
			await deleteSession(request, session);
		}
	};
}

/**
 * The session to send this call to. A conversation keeps one session and
 * sends it only the turns added since its last reply: providers route and
 * cache by session, so a new session per call misses the cache however much
 * of the prompt repeats. A transcript the kept session does not continue (a
 * restart, a discarded reply) starts a new session with the whole transcript.
 */
export async function openTurn(request: TurnRequest): Promise<SessionTurn> {
	const { conversation } = request;

	if (!conversation) return throwawayTurn(request);

	const existing = kept.get(conversation);
	const added = existing && newTurns(existing, request);

	if (existing && !added) await deleteSession(request, existing.id);
	else if (!existing)
		conversation.onClose(async () => {
			const last = kept.get(conversation);

			kept.delete(conversation);
			if (last) await deleteSession(request, last.id);
		});

	const session: KeptSession =
		existing && added
			? existing
			: {
					id: await createSession(request),
					model: request.model,
					system: request.system,
					variant: request.variant,
					turns: 0,
					reply: '',
					lastMessageId: null
				};

	kept.set(conversation, session);

	return {
		session: session.id,
		text: added ? added.map((m) => m.content).join('\n\n') : flatten(request.turns),
		commit: (reply, messageId) => {
			session.turns = request.turns.length + 1;
			session.reply = reply;
			session.lastMessageId = messageId ?? null;
		},
		end: async (ok, aborted) => {
			if (ok) return;

			await abortSession(request, session.id, aborted);

			try {
				await rollBack(request, session);
			} catch {
				if (kept.get(conversation) === session) kept.delete(conversation);
				await deleteSession(request, session.id);
			}
		}
	};
}
