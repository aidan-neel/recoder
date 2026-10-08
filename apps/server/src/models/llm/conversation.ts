import type { ChatMessage } from './types';

/**
 * One agent's run of model calls. A transport that keeps state between calls
 * (an OpenCode session, so the provider's prompt cache is reused turn after
 * turn) ties it to this handle and frees it when the conversation closes.
 */
export class ChatConversation {
	private readonly closers: (() => Promise<void>)[] = [];

	/** Register cleanup to run when the conversation closes. */
	onClose(closer: () => Promise<void>): void {
		this.closers.push(closer);
	}

	/** Free what transports kept for this conversation. Cleanup is best effort and never throws. */
	async close(): Promise<void> {
		await Promise.all(this.closers.splice(0).map((closer) => closer().catch(() => {})));
	}
}

/** A transcript the model does not hold yet, as one text: a lone turn as it is, else each turn labeled by role. */
function transcriptText(turns: ChatMessage[]): string {
	return turns.length === 1
		? turns[0].content
		: turns.map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}:\n${m.content}`).join('\n\n');
}

/** What a transport's kept session holds of a conversation, and the settings it was made with. */
export interface HeldTranscript {
	model: string;
	system: string;
	/** The reasoning setting the session runs with, as the transport names it. */
	variant?: string;
	/** How many turns of the transcript the session holds, the last reply included. */
	turns: number;
	reply: string;
}

/**
 * The turns added since the session's last reply, when the transcript only grew by user turns after it and the
 * call's settings match the session's; null when the session cannot continue it.
 */
export function addedTurns(
	held: HeldTranscript,
	call: Omit<HeldTranscript, 'turns' | 'reply'> & { turns: ChatMessage[] }
): ChatMessage[] | null {
	const added = call.turns.slice(held.turns);
	const last = call.turns[held.turns - 1];

	const continues =
		held.model === call.model &&
		held.system === call.system &&
		held.variant === call.variant &&
		added.length > 0 &&
		last?.role === 'assistant' &&
		last.content === held.reply &&
		added.every((m) => m.role === 'user');

	return continues ? added : null;
}

/** What a call sends: only the `added` turns when its session continues the transcript, else all of `turns`. */
export function promptText(added: ChatMessage[] | null, turns: ChatMessage[]): string {
	return added ? added.map((m) => m.content).join('\n\n') : transcriptText(turns);
}
