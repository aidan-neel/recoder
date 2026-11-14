'use client';

import { Button, StatusNotice } from '@recoder/ui';
import { MessageSquareOff, RotateCcw } from 'lucide-react';
import Link from 'next/link';

import { useApi } from '@/lib/api/client';
import type { RepoChatView } from '@/lib/chat/types';
import { useRepoChat } from '@/lib/chat/use-repo-chat';
import { newReviewHref } from '@/lib/shell/routes';

import { Crumbs, type Crumb } from '@/components/common/crumbs';
import { Page } from '@/components/common/page';
import { FilePanelHost } from '@/components/files/file-panel-host';

import { ChatConversation, ChatSkeleton } from './chat-conversation';

/**
 * A chat with Recoder about one repository: the bar names the repository and
 * the chat, and the conversation reads down one column over a docked
 * composer. A chat that is gone, or that did not load, says so in its place.
 */
export function ChatScreen({ chatId }: { chatId: string }) {
	const chat = useRepoChat(chatId);

	return (
		<Page start={<Crumbs parts={chatCrumbs(chat)} />}>
			<ChatBody chat={chat} />
		</Page>
	);
}

/** The repository, then the chat's title; nothing until the chat loads. */
function chatCrumbs(chat: RepoChatView): Crumb[] {
	if (!chat.title) return [];
	if (!chat.repoName) return [{ label: chat.title }];

	return [{ label: chat.repoName }, { label: chat.title }];
}

function ChatBody({ chat }: { chat: RepoChatView }) {
	if (chat.phase === 'missing') return <ChatMissing />;
	if (chat.phase === 'failed') return <ChatFailed error={chat.error} retry={chat.reload} />;
	if (chat.phase === 'loading' || chat.repoId === null) return <ChatSkeleton />;

	return (
		<FilePanelHost repoId={chat.repoId}>
			<ChatConversation chat={chat} />
		</FilePanelHost>
	);
}

/** A chat the server does not have: deleted, or the link is wrong. */
function ChatMissing() {
	const { base } = useApi();

	return (
		<div className="page-notice">
			<StatusNotice
				variant="banner"
				heading="h1"
				glyph={<MessageSquareOff aria-hidden />}
				title="This chat does not exist."
				detail="The link may be old or mistyped."
				actions={
					<Button asChild>
						<Link href={newReviewHref(base)}>Start a chat</Link>
					</Button>
				}
			/>
		</div>
	);
}

/** A chat that did not load: the server did not answer, or answered with an error. */
function ChatFailed({ error, retry }: { error: string | null; retry: () => void }) {
	return (
		<div className="page-notice">
			<StatusNotice
				tone="danger"
				heading="h1"
				title="The chat did not load."
				detail={error}
				actions={
					<Button onClick={retry}>
						<RotateCcw aria-hidden />
						Try again
					</Button>
				}
			/>
		</div>
	);
}
