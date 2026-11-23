import type { Conversation } from '@recoder/shared';

/** The most heads that stack above the launcher; everyone else is in the launcher's inbox. */
const HEAD_LIMIT = 4;

/** How long a conversation stays a head after its last message, or after it was last opened or minimised. */
export const QUIET_MS = 24 * 60 * 60 * 1000;

/** When the conversation last moved: its newest message, or when it was kept as a head. */
function activity(conversation: Conversation, kept: Record<string, number>): number {
	return Math.max(
		Date.parse(conversation.lastMessage?.createdAt ?? conversation.updatedAt),
		kept[conversation.id] ?? 0
	);
}

/**
 * The heads beside the launcher, newest activity first, at most `HEAD_LIMIT`: each conversation with unread
 * messages or with activity in the last `QUIET_MS`. The one open in the window always has a head, in the last place
 * when it would fall off, so its window has a bubble to rise from and to hand focus back to.
 */
export function dockHeads(
	conversations: readonly Conversation[],
	kept: Record<string, number>,
	openId: string | null,
	now: number
): Conversation[] {
	const live = conversations
		.filter((item) => item.id === openId || item.unread > 0 || now - activity(item, kept) < QUIET_MS)
		.sort((a, b) => activity(b, kept) - activity(a, kept));

	const shown = live.slice(0, HEAD_LIMIT);
	const open = live.find((item) => item.id === openId);

	if (!open || shown.includes(open)) return shown;

	return [...shown.slice(0, HEAD_LIMIT - 1), open];
}
