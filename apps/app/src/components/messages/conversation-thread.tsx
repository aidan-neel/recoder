'use client';

import type { Conversation, DirectMessage, PullAttachment } from '@recoder/shared';
import { Button, Markdown, Icon } from '@recoder/ui';

import type { ConversationView, OutgoingMessage } from '@/lib/messages/use-conversation';
import { displayName } from '@/lib/people/refs';
import { clockTime, dayDate, fullTime } from '@/lib/shell/age';

import { Avatar } from '@/components/common/avatar';

import { PullChip } from './pull-chip';

/** How long one person may pause and still go on in the same run of bubbles. */
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

/** The day a time falls on: Today, Yesterday, or the date. */
function dayLabel(at: string, now: Date): string {
	const day = new Date(at);
	const yesterday = new Date(now);

	yesterday.setDate(now.getDate() - 1);

	if (day.toDateString() === now.toDateString()) return 'Today';
	if (day.toDateString() === yesterday.toDateString()) return 'Yesterday';

	return dayDate(at);
}

function newDay(line: Line, previous: Line | undefined): boolean {
	return !previous || new Date(line.at).toDateString() !== new Date(previous.at).toDateString();
}

function longPause(line: Line, previous: Line | undefined): boolean {
	return !previous || Date.parse(line.at) - Date.parse(previous.at) > RUN_GAP_MS;
}

/** Whether a line starts a new run of bubbles: another author, a long pause, or another day. */
function startsRun(line: Line, previous: Line | undefined): boolean {
	return !previous || previous.mine !== line.mine || longPause(line, previous) || newDay(line, previous);
}

/** The time over a line, centred: the day and hour on a new day, the hour after a long pause, else none. */
function stampOf(line: Line, previous: Line | undefined, now: Date): string | null {
	if (newDay(line, previous)) return `${dayLabel(line.at, now)} ${clockTime(line.at)}`;

	return longPause(line, previous) ? clockTime(line.at) : null;
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
	/** The signed-in person, as their own messages are named. */
	me: { name: string; avatarUrl: string | null };
}

/**
 * The conversation as chat bubbles, oldest first: the signed-in person's on the right in the accent, the other
 * person's on the left with their avatar beside the last of each run. A new day or a long pause puts its time over
 * the next bubble, and attached pull requests follow their bubble as chips. A message still on its way is faded;
 * one the server refused says why, with Retry. Seen follows the signed-in person's last message once it is read.
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
				const next = all[index + 1];
				const who = line.mine ? me : them;
				const stamp = stampOf(line, previous, now);
				const ends = !next || startsRun(next, line);

				return (
					<div
						key={line.key}
						className="dm-line"
						data-mine={line.mine || undefined}
						data-run={startsRun(line, previous) || undefined}
						data-end={ends || undefined}
					>
						{stamp ? (
							<div className="dm-stamp" role="separator">
								{stamp}
							</div>
						) : null}
						<div className="dm-row">
							{line.mine ? null : ends ? (
								<Avatar name={them.name} src={them.avatarUrl} className="dm-avatar" />
							) : (
								<span className="dm-avatar" aria-hidden data-gap />
							)}
							<article
								className="dm-message"
								data-state={line.outgoing?.state}
								aria-label={`${who.name}, ${clockTime(line.at)}`}
								title={fullTime(line.at)}
							>
								{line.body ? (
									<div className="dm-bubble">
										<Markdown>{line.body}</Markdown>
									</div>
								) : null}
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
						</div>
						{line.sequence !== null && line.sequence === seen ? <p className="dm-seen">Seen</p> : null}
					</div>
				);
			})}
		</div>
	);
}
