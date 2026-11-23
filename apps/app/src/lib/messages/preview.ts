import type { Conversation, DirectMessage } from '@recoder/shared';

/** A message's first line, or what it carried when it holds only a pull request. */
export function firstLine(message: DirectMessage): string {
	return message.body.trim().split('\n')[0] || (message.attachments.length > 0 ? 'Sent a pull request' : '');
}

/** The newest message's first line, with "You:" before one the signed-in person sent. */
export function conversationPreview(conversation: Conversation): string {
	const last = conversation.lastMessage;

	if (!last) return 'No messages yet';

	return last.authorId === conversation.with.accountId ? firstLine(last) : `You: ${firstLine(last)}`;
}
