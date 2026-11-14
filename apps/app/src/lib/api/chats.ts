import type {
	RepoChat,
	RepoChatMessage,
	RepoChatSummary,
	SendRepoChatInput,
	StartRepoChatInput
} from '@recoder/shared';

import { del, post, request, seg } from './http';

function chatPath(id: string): string {
	return `/api/chats/${seg(id)}`;
}

/**
 * Opens a chat with Recoder about a tracked repository with its first
 * message, and resolves with the chat's id for `/chats/<id>`. The reply
 * arrives on the chat's events. Rejects with an `ApiError` the composer can
 * show: the repository is not tracked, or no model is set up.
 */
export async function startRepoChat(input: StartRepoChatInput): Promise<{ id: string }> {
	const chat = await post<RepoChat>('/api/chats', input);

	return { id: chat.id };
}

/** Chats with Recoder about a repository: the newest ones, and reading, sending, stopping and deleting one. */
export const chatsApi = {
	recent: (limit: number) => request<RepoChatSummary[]>(`/api/chats?limit=${limit}`),
	chat: (id: string) => request<RepoChat>(chatPath(id)),
	send: (id: string, message: SendRepoChatInput) => post<RepoChatMessage>(`${chatPath(id)}/messages`, message),
	stop: (id: string, messageId: string) => post<{ stopped: boolean }>(`${chatPath(id)}/stop`, { messageId }),

	/** Removes the chat and its messages; the server answers 204, or 404 when the chat is already gone. */
	delete: (id: string) => del<void>(chatPath(id))
};
