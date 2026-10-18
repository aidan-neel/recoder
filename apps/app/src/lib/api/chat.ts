import type { DiscussRequest, DiscussResponse, ReviewChatMessage, ReviewCodeContext } from '@recoder/shared';

import { post, postStream, seg } from './http';
import { streamReply } from './stream-reply';

/** Talking to a review: the orchestrator's conversation and follow-up questions on one finding. */
export const chatApi = {
	/** Sends a message to an assignment's conversation (the orchestrator's id for the main one). The reply arrives on the review's event stream. */
	send: (id: string, assignmentId: string, text: string, codeContext?: ReviewCodeContext) =>
		post<ReviewChatMessage>(`/api/reviews/${seg(id)}/chat`, { assignmentId, text, codeContext }),
	stop: (id: string, assignmentId: string) =>
		post<{ stopped: boolean }>(`/api/reviews/${seg(id)}/chat/stop`, { assignmentId }),

	/** Asks the reviewer that raised a finding a follow-up question; the reply streams token by token. */
	discuss: (id: string, input: DiscussRequest, onToken: (text: string) => void, signal?: AbortSignal) =>
		streamReply<DiscussResponse>(
			(onEvent) => postStream(`/api/reviews/${seg(id)}/discuss/stream`, input, onEvent, signal),
			onToken
		)
};
