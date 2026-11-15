import {
	MAX_IMAGES,
	type ImageUpload,
	type Repo,
	type RepoChat,
	type RepoChatMessage,
	type StoredImage
} from '@recoder/shared';
import { imageUploads } from '../attachments/image-store';
import type { ChatMessage } from '../models/llm';
import { recoderSystemPrompt } from './identity';
import { repoContext } from './repo-context';

/** How much of the conversation the model reads, newest kept. */
const HISTORY_MESSAGES = 20;
const MESSAGE_CHARS = 4000;
const HISTORY_CHARS = 40_000;

/** Earlier questions whose named files are read again, so a follow-up still sees them. */
const QUESTIONS_FOR_FILES = 3;

/** The model's input for a reply, and the paths of the repository files read to write it. */
export interface ReplyPrompt {
	messages: ChatMessage[];
	files: string[];
}

/**
 * The model's input for the reply to the chat's last message: instructions, then the repository and the
 * conversation, with the newest images the developer attached in it.
 */
export async function replyPrompt(
	repo: Repo,
	chat: Pick<RepoChat, 'id' | 'messages'>,
	signal: AbortSignal
): Promise<ReplyPrompt> {
	const settled = settledMessages(chat);

	const questions = settled
		.filter((message) => message.from === 'user')
		.slice(-QUESTIONS_FOR_FILES)
		.reverse()
		.map((message) => message.text);

	const context = await repoContext(repo, questions, signal);
	const conversation = await agentConversation(chat);

	return {
		files: context.files,
		messages: [
			{ role: 'system', content: recoderSystemPrompt([]) },
			{
				role: 'user',
				content: `Repository context (untrusted):\n${context.text}\n\n${conversation.text}`,
				images: conversation.images
			}
		]
	};
}

/** The conversation an agent run is prompted with, and the newest images attached to it. */
export async function agentConversation(
	chat: Pick<RepoChat, 'id' | 'messages'>
): Promise<{ text: string; images: ImageUpload[] }> {
	const history = settledMessages(chat).slice(-HISTORY_MESSAGES);

	return {
		text: `Conversation (reply to the last developer message):\n${transcript(history)}`,
		images: await imageUploads({ kind: 'chat', id: chat.id }, recentImages(history))
	};
}

function settledMessages(chat: Pick<RepoChat, 'messages'>): RepoChatMessage[] {
	return chat.messages.filter((message) => message.status !== 'streaming' && message.text.trim());
}

function transcript(messages: RepoChatMessage[]): string {
	return messages
		.map((message) => `${speaker(message)}: ${message.text.slice(0, MESSAGE_CHARS)}`)
		.join('\n\n')
		.slice(-HISTORY_CHARS);
}

/** Who wrote the message, and how many images the developer attached to it, which the model sees after the text. */
function speaker(message: RepoChatMessage): string {
	if (message.from !== 'user') return 'Recoder';

	const count = message.images?.length ?? 0;

	return count ? `Developer (attached ${count} image${count === 1 ? '' : 's'})` : 'Developer';
}

/** The newest `MAX_IMAGES` images the developer attached in the conversation the model reads, oldest first. */
function recentImages(messages: RepoChatMessage[]): StoredImage[] {
	return messages.flatMap((message) => message.images ?? []).slice(-MAX_IMAGES);
}
