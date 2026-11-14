import { ChatSkeleton } from '@/components/chat/chat-conversation';
import { Page } from '@/components/common/page';

/** A click on a chat paints its skeleton while the screen loads; the screen keeps the same shape until the chat lands. */
export default function Loading() {
	return (
		<Page>
			<ChatSkeleton />
		</Page>
	);
}
