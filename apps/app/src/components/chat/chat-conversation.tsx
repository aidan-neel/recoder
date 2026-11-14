'use client';

import { Skeleton, SkeletonText, StatusNotice } from '@recoder/ui';

import { useFollowEnd } from '@/lib/ask/use-follow-end';
import type { RepoChatView } from '@/lib/chat/types';
import { useImageDraft } from '@/lib/compose/use-image-draft';

import { AskThread } from '@/components/ask/ask-thread';
import { ChatComposer } from '@/components/ask/chat-composer';
import { ComposerModels } from '@/components/ask/model-menu';

/**
 * The conversation in one readable column down the middle of the page, the
 * composer docked under it in the same column. It opens on the newest
 * message and follows a reply as it arrives, unless the person scrolled up
 * to read back.
 */
export function ChatConversation({ chat }: { chat: RepoChatView }) {
	const { ask } = chat;
	const images = useImageDraft();
	const scroller = useFollowEnd(ask.replying);

	/** Sends the words with the images attached; the images clear once the message is taken. */
	async function send(text: string): Promise<void> {
		await ask.send(text, images.uploads());
		images.clear();
	}

	const subject = chat.repoName ? `Ask about ${chat.repoName}` : 'Ask about this repository';

	return (
		<>
			<div ref={scroller} className="chat-scroll">
				<div className="chat-column chat-thread">
					<AskThread ask={ask} />
				</div>
			</div>
			<div className="chat-dock">
				<div className="chat-column chat-dock-column">
					{chat.note ? (
						<StatusNotice variant="inline" tone={chat.note.tone} title={chat.note.text} className="chat-note" />
					) : null}
					<ChatComposer
						label={subject}
						placeholder={subject}
						limit={ask.limit}
						busy={ask.replying}
						onStop={ask.stop}
						onSend={send}
						images={images}
						trailing={<ComposerModels />}
					/>
				</div>
			</div>
		</>
	);
}

/** Where the first question and its reply will stand while the chat loads. */
export function ChatSkeleton() {
	return (
		<div className="chat-scroll" aria-hidden>
			<div className="chat-column chat-thread chat-skeleton">
				<Skeleton className="chat-skeleton-question" />
				<SkeletonText lineHeight={22} />
			</div>
		</div>
	);
}
