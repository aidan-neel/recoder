'use client';

import type { Conversation, DirectMessage, PullAttachment } from '@recoder/shared';
import { Button, Markdown, Icon } from '@recoder/ui';

import type { ConversationView, OutgoingMessage } from '@/lib/messages/use-conversation';
import { displayName } from '@/lib/people/refs';
import { clockTime, dayDate, fullTime } from '@/lib/shell/age';

import { Avatar } from '@/components/common/avatar';

import { PullChip } from './pull-chip';

/** How long one person may pause and still go on under the same name and hour. */
const RUN_GAP_MS = 5 * 60 * 1000;

/** A message on the page: one the server holds, or one still on its way. */
interface Line {
	key: string;
	mine: boolean;
	body: string;
	attachments: PullAttachment[];
	at: string;
	sequence: number | null;
	outgoing: OutgoingMessage | null;
}

function lines(view: ConversationView, theirId: string): Line[] {
	const held = view.messages.map((message: DirectMessage): Line => ({
		key: message.clientId,
		mine: message.authorId !== theirId,
		body: message.body,
		attachments: message.attachments,
		at: message.createdAt,
		sequence: message.sequence,
		outgoing: null
	}));

	const going = view.outgoing.map((message): Line => ({
		key: message.clientId,
		mine: true,
		body: message.body,
		attachments: message.attachments,
		at: message.createdAt,
		sequence: null,
		outgoing: message
	}));

	return [...held, ...going];
}

/** The day a time falls on, as the divider names it: Today, Yesterday, or the date. */
function dayLabel(at: string, now: Date): string {
	const day = new Date(at);
	const yesterday = new Date(now);

	yesterday.setDate(now.getDate() - 1);

	if (day.toDateString() === now.toDateString()) return 'Today';
	if (day.toDateString() === yesterday.toDateString()) return 'Yesterday';

	return dayDate(at);
}

/** Whether a line starts a new run under its author's name: another author, a long pause, or another day. */
function startsRun(line: Line, previous: Line | undefined): boolean {
	if (!previous || previous.mine !== line.mine) return true;

	return Date.parse(line.at) - Date.parse(previous.at) > RUN_GAP_MS || newDay(line, previous);
}

function newDay(line: Line, previous: Line | undefined): boolean {
	return !previous || new Date(line.at).toDateString() !== new Date(previous.at).toDateString();
}

/** The sequence of the newest message the other person has read that the signed-in person sent; null for none. */
function seenAt(all: Line[], conversation: Conversation): number | null {
	const mine = all.filter((line) => line.mine && line.sequence !== null);
	const last = mine.at(-1);

	if (!last || last !== all.filter((line) => line.sequence !== null).at(-1)) return null;

	return last.sequence !== null && last.sequence <= conversation.theirReadSequence ? last.sequence : null;
}

interface ThreadProps {
	view: ConversationView;
	conversation: Conversation;
	/** The signed-in person, as their own messages are signed. */
	me: { name: string; avatarUrl: string | null };
}

/**
 * The conversation, oldest first: a divider for each day, each run of messages under its author's avatar, name and
 * hour, and the pull requests attached as chips. A message still on its way is drawn faded; one the server refused
 * says why, with Retry. Seen follows the signed-in person's last message once the other person has read it.
 */
export function ConversationThread({ view, conversation, me }: ThreadProps) {
	const them = { name: displayName(conversation.with), avatarUrl: conversation.with.avatarUrl };
	const all = lines(view, conversation.with.accountId);
	const seen = seenAt(all, conversation);
	const now = new Date();

	return (
		<div className="dm-thread" role="log" aria-label={`Conversation with ${them.name}`}>
			{view.hasOlder ? (
				<Button
					variant="ghost"
					className="dm-older"
					status={view.loadingOlder ? 'pending' : 'idle'}
					onClick={view.loadOlder}
				>
					Load earlier messages
				</Button>
			) : null}
			{all.map((line, index) => {
				const previous = all[index - 1];
				const who = line.mine ? me : them;

				return (
					<div key={line.key} className="dm-line" data-run={startsRun(line, previous) || undefined}>
						{newDay(line, previous) ? (
							<div className="dm-day" role="separator">
								<span>{dayLabel(line.at, now)}</span>
							</div>
						) : null}
						{startsRun(line, previous) ? (
							<div className="dm-author">
								<Avatar name={who.name} src={who.avatarUrl} className="dm-avatar" />
								<span className="dm-name">{who.name}</span>
								<time dateTime={line.at} title={fullTime(line.at)} className="dm-time">
									{clockTime(line.at)}
								</time>
							</div>
						) : null}
						<article className="dm-message" data-state={line.outgoing?.state} aria-label={`${who.name} said`}>
							{line.body ? <Markdown>{line.body}</Markdown> : null}
							{line.attachments.length > 0 ? (
								<div className="dm-attachments">
									{line.attachments.map((attachment) => (
										<PullChip key={`${attachment.repoId}#${attachment.number}`} attachment={attachment} />
									))}
								</div>
							) : null}
							{line.outgoing?.state === 'failed' ? (
								<p className="dm-failed" role="alert">
									{line.outgoing.error ?? 'The message was not sent.'}
									<Button variant="outline" onClick={() => view.resend(line.key)}>
										<Icon name="refresh" />
										Retry
									</Button>
								</p>
							) : null}
						</article>
						{line.sequence !== null && line.sequence === seen ? <p className="dm-seen">Seen</p> : null}
					</div>
				);
			})}
		</div>
	);
}
