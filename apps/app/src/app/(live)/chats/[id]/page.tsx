import type { Metadata } from 'next';

import { ChatScreen } from '@/components/chat/chat-screen';

export const metadata: Metadata = { title: 'Chat' };

interface ChatPageProps {
	params: Promise<{ id: string }>;
}

export default async function ChatPage({ params }: ChatPageProps) {
	return <ChatScreen chatId={decodeURIComponent((await params).id)} />;
}
