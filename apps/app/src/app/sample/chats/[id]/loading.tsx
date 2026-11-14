import { ChatSkeleton } from '@/components/chat/chat-conversation';
import { Page } from '@/components/common/page';

/** The same loading skeleton the live chat page carries, so the sample navigates the way the app does. */
export default function Loading() {
	return (
		<Page>
			<ChatSkeleton />
		</Page>
	);
}
