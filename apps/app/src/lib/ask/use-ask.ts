'use client';

import { MAX_CHAT_MESSAGE_CHARS, MAX_QUESTION_CHARS } from '@recoder/shared';
import { useCallback, useMemo } from 'react';

import { useSession, useSessionData } from '../pull/pull-session';
import { bugMessages, pullMessages, pullRows } from './ask-messages';
import { EMPTY_THREAD, isReplying } from './bug-thread';
import { inFlightReply, orchestratorMessages, retryFor } from './conversation';
import { BUG_SUGGESTIONS, PULL_SUGGESTIONS } from './suggestions';
import type { AskScope, AskView } from './types';

/** The conversation about the whole pull request: Recoder's review session. */
function usePullAsk(): AskView {
	const session = useSession();
	const messages = useSessionData((data) => data.progress?.messages);
	const outbox = useSessionData((data) => data.outbox);
	const chat = session.pullChat;
	const rows = useMemo(() => pullRows(messages, outbox), [messages, outbox]);

	const retry = useCallback(
		(messageId: string) => {
			const outgoing = outbox.find((candidate) => candidate.key === messageId && candidate.state === 'failed');

			if (outgoing) {
				void chat.resend(outgoing.key);

				return;
			}

			const question = retryFor(
				rows,
				rows.findIndex((row) => row.key === messageId)
			);

			if (question) void chat.send(question);
		},
		[outbox, rows, chat]
	);

	return useMemo(
		() => ({
			messages: pullMessages(rows),
			replying:
				inFlightReply(orchestratorMessages(messages)) !== null || outbox.some((item) => item.state === 'pending'),
			suggestions: PULL_SUGGESTIONS,
			limit: MAX_CHAT_MESSAGE_CHARS,
			send: chat.send,
			stop: () => void chat.stop(),
			retry
		}),
		[rows, messages, outbox, chat, retry]
	);
}

/** The thread about one finding. */
function useBugAsk(bugId: string | null): AskView {
	const session = useSession();
	const thread = useSessionData((data) => (bugId ? (data.threads[bugId] ?? EMPTY_THREAD) : EMPTY_THREAD));
	const chat = session.bugChat;
	const id = bugId ?? '';

	return useMemo(
		() => ({
			messages: bugMessages(thread),
			replying: isReplying(thread),
			suggestions: BUG_SUGGESTIONS,
			limit: MAX_QUESTION_CHARS,
			send: (text: string) => chat.ask(id, text),
			stop: () => chat.stop(id),
			retry: () => void chat.retry(id)
		}),
		[thread, chat, id]
	);
}

/**
 * A conversation with Recoder about the pull request or one of its findings.
 * Both hooks run on every call so their order never changes; the scope picks one.
 */
export function useAskView(scope: AskScope): AskView {
	const bugId = scope.kind === 'bug' ? scope.bugId : null;
	const pull = usePullAsk();
	const bug = useBugAsk(bugId);

	return bugId === null ? pull : bug;
}
