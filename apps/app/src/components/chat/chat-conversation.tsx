'use client';

import { Button, SkeletonBox, SkeletonText, StatusNotice, focusComposerField } from '@recoder/ui';
import { ArrowDownIcon } from '@phosphor-icons/react';
import { useRef } from 'react';

import { useFollowEnd } from '@/lib/ask/use-follow-end';
import type { RepoChatView } from '@/lib/chat/types';
import { useImageDraft } from '@/lib/compose/use-image-draft';
import { useRepoSkills } from '@/lib/skills/use-repo-skills';

import { AskThread } from '@/components/ask/ask-thread';
import { ChatComposer, type ChatComposerHandle } from '@/components/ask/chat-composer';
import { ComposerModels } from '@/components/ask/model-menu';

/**
 * The conversation in one readable column down the middle of the page, the
 * composer docked under it in the same column. It opens on the newest
 * message and follows a reply as it arrives, unless the person scrolled up
 * to read back; then a Scroll to end over the composer brings them down.
 */
export function ChatConversation({ chat }: { chat: RepoChatView }) {
	const { ask } = chat;
	const images = useImageDraft();
	const { scroller, away, toEnd } = useFollowEnd(ask.replying);
	const skills = useRepoSkills({ repoId: chat.repoId });
	const composer = useRef<ChatComposerHandle>(null);
	const dock = useRef<HTMLDivElement>(null);

	/** Sends the words with the images attached; the images clear once the message is taken. */
	async function send(text: string): Promise<void> {
		await ask.send(text, images.uploads());
		images.clear();
	}

	/** Quotes a reply in the composer and puts the caret under the quote once it is drawn. */
	function reply(text: string): void {
		composer.current?.quote(text);
		requestAnimationFrame(() => focusComposerField(dock.current?.querySelector('[data-ui="composer"]') ?? null));
	}

	const subject = chat.repoName ? `Ask about ${chat.repoName}` : 'Ask about this repository';

	return (
		<>
			<div ref={scroller} className="chat-scroll">
				<div className="chat-column chat-thread">
					<AskThread ask={ask} onReply={reply} />
				</div>
			</div>
			<div className="chat-dock">
				<div ref={dock} className="chat-column chat-dock-column">
					{away && !chat.note ? (
						<Button variant="secondary" className="chat-to-end" onClick={toEnd}>
							<ArrowDownIcon aria-hidden />
							Scroll to end
						</Button>
					) : null}
					{chat.note ? (
						<StatusNotice variant="inline" tone={chat.note.tone} title={chat.note.text} className="chat-note" />
					) : null}
					<ChatComposer
						ref={composer}
						label={subject}
						placeholder={subject}
						limit={ask.limit}
						busy={ask.replying}
						onStop={ask.stop}
						onSend={send}
						images={images}
						skills={skills}
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
				<SkeletonBox className="chat-skeleton-question" />
				<SkeletonText lineHeight={22} />
			</div>
		</div>
	);
}
